import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addLocalDays, dateOnlyDue, startOfLocalDay, startOfLocalDayIso, toLocalDate } from '@/lib/due-dates'
import { NULL_DATE } from '@/lib/constants'
import { groupPlannerTasks, plannerCalendarDate, plannerStartDateOnDrop, plannerTaskFilter, plannerTaskSortKey, plannerUnplannedTasks, plannerVisibleDayCount, PLANNER_DAY_COUNT } from '@/lib/planner'
import type { Task } from '@/lib/vikunja-types'

function task(id: number, fields: Partial<Task> = {}): Task {
  return { id, due_date: NULL_DATE, start_date: NULL_DATE, project_id: 1, done: false, ...fields } as Task
}

for (const zone of ['Pacific/Auckland', 'America/New_York']) {
  describe(`Planner in ${zone}`, () => {
    const originalTZ = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { process.env.TZ = originalTZ })

    it('bounds completed tasks by start window and fetches all open tasks without consulting due', () => {
      const now = new Date(2026, 4, 31, 12)
      expect(plannerTaskFilter(now)).toBe(
        `done = false || (start_date >= '${startOfLocalDayIso(0, now)}' && start_date < '${startOfLocalDayIso(PLANNER_DAY_COUNT, now)}')`,
      )
    })

    it('keeps a picked day only while it still has a visible heading', () => {
      const now = new Date(2026, 4, 31, 12)
      expect(plannerCalendarDate(null, now)).toBe('2026-05-31')
      expect(plannerCalendarDate('2026-06-01', now)).toBe('2026-06-01')
      expect(plannerCalendarDate('2026-06-02', now)).toBe('2026-06-02')
      expect(plannerCalendarDate('2026-06-03', now)).toBe('2026-05-31')
      expect(plannerCalendarDate('2026-05-30', now)).toBe('2026-05-31')
      expect(plannerCalendarDate('2026-05-31', new Date(2026, 5, 1))).toBe('2026-06-01')
      expect(plannerCalendarDate('2026-06-01', now, 1)).toBe('2026-05-31')
      expect(plannerCalendarDate('2026-06-01', now, 2)).toBe('2026-06-01')
      expect(plannerCalendarDate('2026-06-02', now, 2)).toBe('2026-05-31')
      expect(plannerCalendarDate('2026-06-02', now, 3)).toBe('2026-06-02')
    })

    it('uses a browsed range for calendar selection, including past dates and resizing', () => {
      const windowStart = new Date(2025, 11, 31)
      expect(plannerCalendarDate(null, windowStart, 2)).toBe('2025-12-31')
      expect(plannerCalendarDate('2026-01-01', windowStart, 2)).toBe('2026-01-01')
      expect(plannerCalendarDate('2026-01-01', windowStart, 1)).toBe('2025-12-31')
      expect(plannerCalendarDate('2025-12-30', windowStart, 2)).toBe('2025-12-31')
      expect(plannerCalendarDate('2026-01-02', windowStart, 2)).toBe('2025-12-31')
    })

    it.each(['2025-12-31', '2026-03-07', '2026-09-26', '2027-01-01'])(
      'bounds the browsed window by local dates across year and DST changes from %s', (firstDay) => {
        const windowStart = startOfLocalDay(firstDay)
        const end = startOfLocalDay(addLocalDays(firstDay, PLANNER_DAY_COUNT))
        expect(plannerTaskFilter(windowStart)).toBe(
          `done = false || (start_date >= '${windowStart.toISOString()}' && start_date < '${end.toISOString()}')`,
        )
        const days = groupPlannerTasks([], new Set([1]), new Date(2026, 4, 31), firstDay)
        expect(days.slice(1).map((day) => day.date)).toEqual(
          [firstDay, addLocalDays(firstDay, 1), addLocalDays(firstDay, 2)],
        )
      },
    )

    it.each([
      [600, 1], [870, 1], [871, 2], [1090, 2], [1250, 2], [1420, 2], [1421, 3], [1800, 3],
    ])('uses the expected dated-column count at %ipx', (width, count) => {
      expect(plannerVisibleDayCount(width)).toBe(count)
    })

    it('selects all open active-project tasks without a valid start as unplanned, regardless of due or duration', () => {
      const tasks = [
        task(1),
        task(2, { done: true }),
        task(3, { due_date: '2026-06-01T12:00:00Z', description: '<!-- vicu-duration:v1:45 -->' }),
        task(4, { start_date: '2026-06-01T09:00:00Z' }),
        task(5, { project_id: 9 }),
        task(6, { due_date: dateOnlyDue('2026-05-01') }),
        task(7, { start_date: 'invalid', due_date: dateOnlyDue('2026-06-01') }),
        task(8, { start_date: '' }),
      ]
      expect(plannerUnplannedTasks(tasks, new Set([1])).map((item) => item.id)).toEqual([1, 3, 6, 7, 8])
    })

    it('groups by local start date, never allowing due-only tasks into dated or overdue columns', () => {
      const now = new Date(2026, 4, 31, 12)
      const at = (offset: number, hour = 9) => new Date(2026, 4, 31 + offset, hour).toISOString()
      const tasks = [
        task(1, { start_date: at(0), due_date: at(2) }),
        task(2, { start_date: at(1), due_date: at(-1) }),
        task(3, { start_date: at(2) }),
        task(4, { start_date: at(-1), due_date: at(0) }),
        task(5, { start_date: at(PLANNER_DAY_COUNT), due_date: at(0) }),
        task(6, { due_date: at(0) }),
        task(7, { due_date: dateOnlyDue('2026-05-30') }),
        task(8, { start_date: 'invalid', due_date: at(0) }),
        task(9, { start_date: at(0, 0) }),
      ]
      const days = groupPlannerTasks(tasks, new Set([1]), now)
      expect(days.map((day) => day.date)).toEqual([null, '2026-05-31', '2026-06-01', '2026-06-02'])
      expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[4], [9, 1], [2], [3]])
    })

    it('keeps completed tasks in dated columns in start-time order, but not in overdue or unplanned', () => {
      const now = new Date(2026, 4, 31, 12)
      const tasks = [
        task(1, { start_date: new Date(2026, 4, 30, 9).toISOString(), done: true }),
        task(2, { start_date: new Date(2026, 4, 31, 12).toISOString() }),
        task(3, { start_date: new Date(2026, 4, 31, 10).toISOString(), done: true }),
        task(4, { start_date: new Date(2026, 4, 31, 14).toISOString() }),
        task(5, { due_date: dateOnlyDue('2026-05-31'), done: true }),
      ]
      const days = groupPlannerTasks(tasks, new Set([1]), now)
      expect(days[0].tasks).toEqual([])
      expect(days[1].tasks.map((item) => item.id)).toEqual([3, 2, 4])
      expect(days[1].tasks[0].done).toBe(true)
      expect(plannerUnplannedTasks(tasks, new Set([1]))).toEqual([])
    })

    it('shows open and completed past tasks in their browsed days without duplicating overdue tasks', () => {
      const now = new Date(2026, 5, 10, 12)
      const tasks = [
        task(1, { start_date: new Date(2026, 5, 6, 9).toISOString() }),
        task(2, { start_date: new Date(2026, 5, 7, 9).toISOString() }),
        task(3, { start_date: new Date(2026, 5, 7, 10).toISOString(), done: true }),
        task(4, { start_date: new Date(2026, 5, 8, 9).toISOString() }),
        task(5, { start_date: new Date(2026, 5, 9, 9).toISOString(), done: true }),
        task(6, { start_date: new Date(2026, 5, 6, 10).toISOString(), done: true }),
      ]
      const days = groupPlannerTasks(tasks, new Set([1]), now, '2026-06-07')
      expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[1], [2, 3], [4], [5]])
    })

    it('keeps overdue relative to today when browsing the future', () => {
      const now = new Date(2026, 5, 10, 12)
      const tasks = [
        task(1, { start_date: new Date(2026, 5, 9, 9).toISOString() }),
        task(2, { start_date: new Date(2026, 5, 10, 9).toISOString() }),
        task(3, { start_date: new Date(2026, 5, 11, 9).toISOString() }),
        task(4, { start_date: new Date(2026, 5, 20, 9).toISOString(), done: true }),
      ]
      const days = groupPlannerTasks(tasks, new Set([1]), now, '2026-06-20')
      expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[1], [4], [], []])
    })

    it('uses only start_date for ordering, ignoring due, end and duration', () => {
      const start = new Date(2026, 5, 1, 9, 30).toISOString()
      const fields = { due_date: dateOnlyDue('2026-06-01'), end_date: start, description: '<!-- vicu-duration:v1:120 -->' }
      expect(plannerTaskSortKey(task(1, { ...fields, start_date: start }))).toBe(Date.parse(start))
      for (const start_date of [NULL_DATE, '', 'invalid', undefined]) {
        expect(plannerTaskSortKey(task(2, { ...fields, start_date }))).toBeNull()
      }
    })

    it('keeps equal start times stable and ignores duration when ordering', () => {
      const now = new Date(2026, 4, 31, 12)
      const at = (hour: number) => new Date(2026, 5, 1, hour).toISOString()
      const tasks = [
        task(1, { start_date: at(12), due_date: at(8) }),
        task(2, { start_date: at(13), description: '<!-- vicu-duration:v1:300 -->' }),
        task(3, { start_date: at(10), due_date: at(20) }),
        task(4, { start_date: at(12), due_date: at(7) }),
      ]
      expect(groupPlannerTasks(tasks, new Set([1]), now)[2].tasks.map((item) => item.id)).toEqual([3, 1, 4, 2])
    })

    it('changes a dropped start date without changing its explicit local time, including across DST', () => {
      const [month, date] = zone === 'Pacific/Auckland' ? [8, 26] : [2, 7]
      const original = new Date(2026, month, date, 9, 30, 45, 123)
      const target = new Date(2026, month, date + 1, 9, 30, 45, 123)
      expect(plannerStartDateOnDrop(original.toISOString(), toLocalDate(target))).toBe(target.toISOString())
      expect(plannerStartDateOnDrop(original.toISOString(), toLocalDate(original))).toBeNull()
    })

    it('preserves midnight and end-of-day start times rather than applying due-date normalization', () => {
      for (const [hour, minute, second] of [[0, 0, 0], [23, 59, 59]]) {
        const original = new Date(2026, 5, 1, hour, minute, second)
        expect(plannerStartDateOnDrop(original.toISOString(), '2026-06-02'))
          .toBe(new Date(2026, 5, 2, hour, minute, second).toISOString())
      }
    })

    it('schedules an unplanned task at local midnight when dropped on a day', () => {
      for (const startDate of [NULL_DATE, '', 'invalid']) {
        expect(plannerStartDateOnDrop(startDate, '2026-06-01')).toBe(new Date(2026, 5, 1).toISOString())
      }
    })

    it('leaves archived-project tasks out and keeps empty day columns', () => {
      const now = new Date(2026, 0, 10, 12)
      const today = toLocalDate(now)
      const days = groupPlannerTasks([
        task(1, { start_date: new Date(2026, 0, 10, 9).toISOString(), project_id: 9 }),
        task(2, { start_date: new Date(2026, 0, 11, 9).toISOString() }),
      ], new Set([1]), now)
      expect(days[2].date).toBe(addLocalDays(today, 1))
      expect(days.map((day) => day.tasks.map((item) => item.id))).toEqual([[], [], [2], []])
    })
  })
}
