import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dateOnlyDue } from '@/lib/due-dates'
import { plannerCalendarEvents, type PlannerCalendarEvent } from '@/lib/planner-calendar'
import { calendarEditChanges, snapCalendarMinutes } from '@/lib/planner-calendar-edit'
import { parseTaskDuration, withTaskDuration } from '@/lib/task-duration'
import { taskPatch } from '@/lib/merge-patches'
import type { Task } from '@/lib/vikunja-types'

const minuteMs = 60_000
const at = (hour: number, minute = 0, date = 10) => new Date(2026, 5, date, hour, minute).toISOString()
const task = (fields: Partial<Task> = {}): Task => ({
  id: 1, title: 'Scheduled task', project_id: 1, due_date: at(18), start_date: at(9),
  end_date: at(23), description: withTaskDuration('<p>Keep my notes</p>\n<!-- other:metadata -->', 60),
  done: false, ...fields,
}) as Task
const eventFor = (original: Task, day = new Date(2026, 5, 10)): PlannerCalendarEvent =>
  plannerCalendarEvents([original], new Set([1]), day).timed[0]

for (const zone of ['Pacific/Auckland', 'America/New_York']) {
  describe(`Calendar editing in ${zone}`, () => {
    const originalTZ = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { process.env.TZ = originalTZ })

    it('moves only start_date, preserving duration, notes, completion and due/end dates', () => {
      const original = task({ done: true })
      const changes = calendarEditChanges(eventFor(original), 'move', 45)
      expect(changes).toEqual({ start_date: at(9, 45) })
      expect(taskPatch(original, changes)).toEqual(changes)
      expect({ ...original, ...changes }).toMatchObject({
        description: original.description, due_date: original.due_date, end_date: original.end_date, done: true,
      })
      expect(original.start_date).toBe(at(9))
    })

    it('resizes the top with a fixed end and preserves other description content', () => {
      const original = task()
      const changes = calendarEditChanges(eventFor(original), 'start', -30)
      expect(changes).toEqual({ start_date: at(8, 30), description: withTaskDuration(original.description, 90) })
      expect(eventFor({ ...original, ...changes }).end.toISOString()).toBe(at(10))
      expect(taskPatch(original, changes)).toEqual(changes)
    })

    it('resizes the bottom by changing duration only when start is already explicit', () => {
      const original = task()
      const changes = calendarEditChanges(eventFor(original), 'end', 30)
      expect(changes).toEqual({ description: withTaskDuration(original.description, 90) })
      expect(eventFor({ ...original, ...changes }).start.toISOString()).toBe(at(9))
    })

    it('does not rewrite an explicit start just because the server uses a different date representation', () => {
      const date = new Date(at(9))
      const offsetMinutes = -date.getTimezoneOffset()
      const sign = offsetMinutes < 0 ? '-' : '+'
      const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
      const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
      for (const start_date of [at(9).replace('.000Z', 'Z'), `2026-06-10T09:00:00${sign}${hours}:${minutes}`]) {
        const original = task({ start_date })
        expect(calendarEditChanges(eventFor(original), 'end', 15)).toEqual({
          description: withTaskDuration(original.description, 75),
        })
      }
    })

    it('preserves an absent duration when moving and resizes from the default 30-minute end', () => {
      const original = task({ start_date: at(10), description: '<p>Default duration</p>' })
      const event = eventFor(original)
      expect(event.end.toISOString()).toBe(at(10, 30))
      expect(calendarEditChanges(event, 'move', 15)).toEqual({ start_date: at(10, 15) })
      expect(calendarEditChanges(event, 'start', -15)).toEqual({
        start_date: at(9, 45), description: withTaskDuration(original.description, 45),
      })
      expect(calendarEditChanges(event, 'end', 15)).toEqual({
        description: withTaskDuration(original.description, 45),
      })
      expect(original.description).toBe('<p>Default duration</p>')
    })

    it('clamps crossing edges to a positive whole-minute duration', () => {
      const original = task({ description: withTaskDuration('', 5) })
      const top = calendarEditChanges(eventFor(original), 'start', 60)
      expect(top).toEqual({ start_date: at(9, 4), description: withTaskDuration('', 1) })
      const bottom = calendarEditChanges(eventFor(original), 'end', -60)
      expect(bottom).toEqual({ description: withTaskDuration('', 1) })
    })

    it('does not write for clicks, a drag back to the original position or invalid deltas', () => {
      const event = eventFor(task())
      for (const mode of ['move', 'start', 'end'] as const) {
        for (const delta of [0, NaN, Infinity]) expect(calendarEditChanges(event, mode, delta)).toEqual({})
      }
      expect(calendarEditChanges(event, 'end', 0)).not.toHaveProperty('start_date')
    })

    it('uses actual instants rather than the clipped or minimum-height visual bounds', () => {
      const original = task({ start_date: at(23, 30, 9), description: withTaskDuration('', 120) })
      const event = eventFor(original)
      expect(event.startMinute).toBe(0)
      expect(calendarEditChanges(event, 'end', 30)).toEqual({ description: withTaskDuration('', 150) })
      const short = task({ start_date: at(23, 59), description: withTaskDuration('', 1) })
      expect(calendarEditChanges(eventFor(short), 'end', 15)).toEqual({ description: withTaskDuration('', 16) })
    })

    it('leaves a date-only due date untouched when a scheduled task is edited', () => {
      const original = task({ due_date: dateOnlyDue('2026-06-11') })
      const changes = calendarEditChanges(eventFor(original), 'start', -15)
      expect(changes).not.toHaveProperty('due_date')
      expect(eventFor({ ...original, ...changes }).start.toISOString()).toBe(at(8, 45))
    })

    it('moves in local clock minutes and preserves elapsed duration across spring-forward', () => {
      const [month, date] = zone === 'Pacific/Auckland' ? [8, 27] : [2, 8]
      const start = new Date(2026, month, date, 1, 30)
      const original = task({ start_date: start.toISOString(), description: withTaskDuration('', 120) })
      const event = eventFor(original, start)
      const changes = calendarEditChanges(event, 'move', 120)
      const moved = eventFor({ ...original, ...changes }, start)
      expect(moved.start.getHours()).toBe(3)
      expect(moved.start.getMinutes()).toBe(30)
      expect(moved.end.getTime() - moved.start.getTime()).toBe(120 * minuteMs)
      const top = calendarEditChanges(event, 'start', 60)
      expect(parseTaskDuration(top.description)).toBe(60)
      expect(eventFor({ ...original, ...top }, start).end.getTime()).toBe(event.end.getTime())
    })

    it('does not jump backwards from the second occurrence of a repeated hour', () => {
      const [month, date, hour] = zone === 'Pacific/Auckland' ? [3, 5, 2] : [10, 1, 1]
      const first = new Date(2026, month, date, hour, 30)
      const second = new Date(first.getTime() + 60 * minuteMs)
      expect(second.getHours()).toBe(hour)
      const event = eventFor(task({ start_date: second.toISOString() }), second)
      const changes = calendarEditChanges(event, 'move', 15)
      expect(new Date(changes.start_date!).getTime() - second.getTime()).toBe(15 * minuteMs)
      const bottom = calendarEditChanges(event, 'end', -15)
      expect(parseTaskDuration(bottom.description)).toBe(45)
    })

    it('keeps an upward gesture moving earlier when it reaches a nonexistent hour', () => {
      const [month, date] = zone === 'Pacific/Auckland' ? [8, 27] : [2, 8]
      const start = new Date(2026, month, date, 3)
      const event = eventFor(task({ start_date: start.toISOString() }), start)
      const changes = calendarEditChanges(event, 'move', -15)
      expect(new Date(changes.start_date!).getTime()).toBe(start.getTime() - 15 * minuteMs)
    })
  })
}

describe('Calendar drag snapping', () => {
  it('snaps displacement in both directions without rounding the original task time', () => {
    expect([0, 4, 7, 7.5, 8, 14, 22, 23, -7, -7.5, -8, -23].map(snapCalendarMinutes)).toEqual([
      0, 0, 0, 15, 15, 15, 15, 30, -0, -15, -15, -30,
    ])
  })
})
