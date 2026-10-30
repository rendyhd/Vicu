import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { plannerCalendarEvents } from '../planner-calendar'
import { encodeRoutineEnvelope, type RoutineCarrier, type RoutineDefinition, type RoutinePayload } from '../routines'
import { withTaskDuration } from '../task-duration'
import type { Task } from '../vikunja-types'

const active = new Set([1])
const today = '2026-06-10'
const day = () => new Date(2026, 5, 10)

function carrier(duration: number | null = 45, fields: Partial<RoutineDefinition> = {}): RoutineCarrier<Task> {
  const payload: RoutinePayload = {
    version: 1,
    definition: {
      id: 'r1', name: 'Morning walk', kind: 'CHORE', healthSubtype: null, amount: '', unit: '',
      iconName: '', color: '#AF52DE',
      schedule: { type: 'calendar', weekdays: [], weekInterval: 1, anchorDate: '2026-01-01' },
      slots: [{ id: 's1', label: '', period: 'MORNING', reminderMinutes: 540, reminderEnabled: false, followUpMinutes: 0 }],
      activeFrom: '2026-01-01', archived: false,
      createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z', updatedBy: 'desktop',
      ...fields,
    },
    occurrences: {}, prunedBefore: '',
  }
  return {
    task: { id: 100, project_id: 1, title: 'Carrier title', done: true, description: withTaskDuration(encodeRoutineEnvelope(payload), duration) } as Task,
    payload,
  }
}

for (const zone of ['Pacific/Auckland', 'America/New_York']) {
  describe(`Planner routines in ${zone}`, () => {
    const originalTZ = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { process.env.TZ = originalTZ })

    it('maps each time independently of reminders, retaining the real carrier and its pending status', () => {
      const source = carrier()
      source.payload.definition.slots = [source.payload.definition.slots[0], {
        ...source.payload.definition.slots[0], id: 's2', reminderMinutes: 1080,
      }]
      const original = JSON.stringify(source)
      const { timed } = plannerCalendarEvents([], active, day(), [source], today)
      expect(timed.map((event) => [event.startMinute, event.endMinute, event.routine?.key])).toEqual([
        [540, 585, 'r1:2026-06-10:s1'], [1080, 1125, 'r1:2026-06-10:s2'],
      ])
      expect(timed[0].routine?.status).toBe('PENDING')
      expect(timed[0].task).toBe(source.task)
      expect(JSON.stringify(source)).toBe(original)
    })

    it('excludes routines without duration without changing their descriptions', () => {
      const source = carrier(null)
      const { timed } = plannerCalendarEvents([], active, day(), [source], today)
      expect(timed).toEqual([])
      expect(source.task.description).not.toContain('vicu-duration')
    })

    it('removes routine blocks when duration is cleared', () => {
      const source = carrier(45)
      expect(plannerCalendarEvents([], active, day(), [source], today).timed).toHaveLength(1)
      const cleared = { ...source, task: { ...source.task, description: withTaskDuration(source.task.description, null) } }
      expect(plannerCalendarEvents([], active, day(), [cleared], today).timed).toEqual([])
    })

    it.each(['0', '1.5', '9007199254740992'])('excludes routines with invalid duration %s', (minutes) => {
      const source = carrier(null)
      source.task.description += `\n<!-- vicu-duration:v1:${minutes} -->`
      expect(plannerCalendarEvents([], active, day(), [source], today).timed).toEqual([])
    })

    it('honors weekdays, week intervals, activation and archive state', () => {
      const source = carrier(30, {
        schedule: { type: 'calendar', weekdays: [3], weekInterval: 2, anchorDate: today },
      })
      expect(plannerCalendarEvents([], active, day(), [source], today).timed).toHaveLength(1)
      expect(plannerCalendarEvents([], active, new Date(2026, 5, 11), [source], today).timed).toEqual([])
      expect(plannerCalendarEvents([], active, new Date(2026, 5, 17), [source], today).timed).toEqual([])
      expect(plannerCalendarEvents([], active, new Date(2026, 5, 24), [source], today).timed).toHaveLength(1)
      expect(plannerCalendarEvents([], active, day(), [carrier(30, { archived: true })], today).timed).toEqual([])
      expect(plannerCalendarEvents([], active, day(), [carrier(30, { activeFrom: '2026-06-11' })], today).timed).toEqual([])
    })

    it('shares overlap columns with tasks without turning carriers into completed task events', () => {
      const source = carrier()
      const task = { id: 1, project_id: 1, start_date: new Date(2026, 5, 10, 9, 15).toISOString(), description: '', done: false } as Task
      const { timed } = plannerCalendarEvents([task], active, day(), [source], today)
      expect(timed.map((event) => event.columnCount)).toEqual([2, 2])
      expect(new Set(timed.map((event) => event.column)).size).toBe(2)
      expect(timed.find((event) => event.routine)?.routine?.status).toBe('PENDING')
    })

    it.each(['COMPLETED', 'SKIPPED'] as const)('retains %s occurrences on the calendar', (status) => {
      const source = carrier()
      const key = 'r1:2026-06-10:s1'
      source.payload.occurrences[key] = {
        key, routineId: 'r1', slotId: 's1', scheduledDate: today, scheduledMinutes: 540,
        status, loggedAt: '', modifiedAt: '2026-06-10T10:00:00Z', modifiedBy: 'desktop', note: '', timeZoneId: zone,
      }
      expect(plannerCalendarEvents([], active, day(), [source], today).timed[0].routine?.status).toBe(status)
    })

    it('shows overdue after-completion routines today, but does not invent future recurrences', () => {
      const source = carrier(30, { schedule: { type: 'after_completion', intervalDays: 14, firstDueDate: '2026-06-08' } })
      const { timed } = plannerCalendarEvents([], active, day(), [source], today)
      expect(timed).toHaveLength(1)
      expect(timed[0]).toMatchObject({ startMinute: 540, routine: { scheduledDate: '2026-06-08' } })
      expect(plannerCalendarEvents([], active, new Date(2026, 5, 11), [source], today).timed).toEqual([])
    })

    it('clips overnight occurrences from the previous day and excludes exact midnight ends', () => {
      const source = carrier(90)
      source.payload.definition.slots[0].reminderMinutes = 1410
      const { timed } = plannerCalendarEvents([], active, day(), [source], today)
      expect(timed.map((event) => [event.startMinute, event.endMinute])).toEqual([[0, 60], [1410, 1440]])
      const midnightEnd = { ...source, task: { ...source.task, description: withTaskDuration(source.task.description, 30) } }
      expect(plannerCalendarEvents([], active, day(), [midnightEnd], today).timed).toHaveLength(1)
    })

    it('uses local slot times and elapsed duration across DST', () => {
      const [month, date] = zone === 'Pacific/Auckland' ? [8, 27] : [2, 8]
      const source = carrier(120)
      source.payload.definition.slots[0].reminderMinutes = 90
      const { timed } = plannerCalendarEvents([], active, new Date(2026, month, date), [source], today)
      expect(timed[0]).toMatchObject({ startMinute: 90, endMinute: 270 })
      expect(timed[0].end.getTime() - timed[0].start.getTime()).toBe(120 * 60_000)
    })
  })
}
