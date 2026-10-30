import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dateOnlyDue } from '@/lib/due-dates'
import { NULL_DATE } from '@/lib/constants'
import { plannerCalendarEvents } from '@/lib/planner-calendar'
import type { Task } from '@/lib/vikunja-types'

const active = new Set([1])
const day = () => new Date(2026, 5, 10)
const at = (hour: number, minute = 0, date = 10) => new Date(2026, 5, date, hour, minute).toISOString()
const duration = (minutes: number) => `<!-- vicu-duration:v1:${minutes} -->`
const task = (id: number, fields: Partial<Task> = {}): Task => ({
  id, title: `Task ${id}`, project_id: 1, due_date: NULL_DATE, start_date: NULL_DATE,
  description: '', done: false, ...fields,
}) as Task

for (const zone of ['Pacific/Auckland', 'America/New_York']) {
  describe(`Planner calendar in ${zone}`, () => {
    const originalTZ = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { process.env.TZ = originalTZ })

    it('uses start plus duration, ignoring both the due date and end_date', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: at(9, 15), due_date: at(20, 0, 11), end_date: at(12), description: duration(45) }),
      ], active, day())
      expect(timed).toHaveLength(1)
      expect(timed[0]).toMatchObject({ startMinute: 555, endMinute: 600, column: 0, columnCount: 1 })
      expect(timed[0].start.toISOString()).toBe(at(9, 15))
      expect(timed[0].end.toISOString()).toBe(at(10))
    })

    it('ignores due-only tasks and defaults invalid duration to 30 minutes without storing it', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { due_date: at(11), description: duration(90) }),
        task(2, { due_date: at(14) }),
        task(3, { start_date: at(15), due_date: at(18), description: duration(0) }),
      ], active, day())
      expect(timed.map((event) => [event.startMinute, event.endMinute])).toEqual([[900, 930]])
      expect(timed[0].end.toISOString()).toBe(at(15, 30))
      expect(timed[0].task.description).toBe(duration(0))
    })

    it('excludes date-only and legacy midnight due-only tasks, even with a duration', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { due_date: dateOnlyDue('2026-06-10'), description: duration(45) }),
        task(2, { due_date: at(0) }),
        task(3, { due_date: dateOnlyDue('2026-06-11') }),
        task(4, { due_date: dateOnlyDue('2026-06-10'), start_date: at(9) }),
      ], active, day())
      expect(timed.map((event) => event.task.id)).toEqual([4])
    })

    it('keeps completed tasks, but excludes archived projects, undated and malformed tasks', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: at(9), done: true }),
        task(2, { due_date: dateOnlyDue('2026-06-10'), done: true }),
        task(3, { start_date: at(10), project_id: 9 }),
        task(4),
        task(5, { start_date: 'invalid', due_date: 'invalid' }),
        task(6, { start_date: at(10), description: duration(Number.MAX_SAFE_INTEGER) }),
      ], active, day())
      expect(timed.map((event) => event.task.id)).toEqual([1])
      expect(timed[0].end.toISOString()).toBe(at(9, 30))
      expect(timed[0].task.description).toBe('')
    })

    it('clips overnight events and uses exclusive day-end boundaries', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: at(23, 30, 9), description: duration(90) }),
        task(2, { start_date: at(23, 30), description: duration(90) }),
        task(3, { start_date: at(23, 30, 9), description: duration(30) }),
        task(4, { start_date: at(0, 0, 11) }),
        task(5, { start_date: at(0) }),
        task(6, { due_date: at(0, 30, 11), description: duration(60) }),
      ], active, day())
      expect(timed.map((event) => [event.task.id, event.startMinute, event.endMinute])).toEqual([
        [1, 0, 60], [5, 0, 30], [2, 1410, 1440],
      ])
    })

    it('separates overlapping tasks, reuses free columns and restores full width after the group', () => {
      const tasks = [
        task(1, { start_date: at(9), description: duration(120) }),
        task(2, { start_date: at(9, 30), description: duration(30) }),
        task(3, { start_date: at(10), description: duration(30) }),
        task(4, { start_date: at(11), description: duration(30) }),
      ]
      const original = JSON.stringify(tasks)
      const { timed } = plannerCalendarEvents(tasks, active, day())
      expect(timed.map((event) => [event.task.id, event.column, event.columnCount])).toEqual([
        [1, 0, 2], [2, 1, 2], [3, 1, 2], [4, 0, 1],
      ])
      expect(JSON.stringify(tasks)).toBe(original)
    })

    it('includes short markers in collision layout and keeps end-of-day markers inside the grid', () => {
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: at(9) }),
        task(2, { start_date: at(9, 5), description: duration(1) }),
        task(3, { start_date: at(23, 59) }),
      ], active, day())
      expect(timed.map((event) => [event.columnCount, event.startMinute, event.endMinute])).toEqual([
        [2, 540, 570], [2, 545, 565], [1, 1420, 1440],
      ])
      expect(timed[2].start.toISOString()).toBe(at(23, 59))
    })

    it('uses local wall-clock coordinates across spring-forward, not elapsed minutes since midnight', () => {
      const [month, date] = zone === 'Pacific/Auckland' ? [8, 27] : [2, 8]
      const start = new Date(2026, month, date, 1, 30)
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: start.toISOString(), description: duration(120) }),
      ], active, start)
      expect(timed[0]).toMatchObject({ startMinute: 90, endMinute: 270 })
      expect(timed[0].end.getTime() - timed[0].start.getTime()).toBe(120 * 60_000)
    })

    it('keeps fall-back intervals visible when their end wall time is before their start', () => {
      const [month, date, hour] = zone === 'Pacific/Auckland' ? [3, 5, 2] : [10, 1, 1]
      const start = new Date(2026, month, date, hour, 45)
      const { timed } = plannerCalendarEvents([
        task(1, { start_date: start.toISOString(), description: duration(30) }),
      ], active, start)
      expect(timed[0].endMinute - timed[0].startMinute).toBe(20)
      expect(timed[0].end.getTime() - timed[0].start.getTime()).toBe(30 * 60_000)
    })
  })
}
