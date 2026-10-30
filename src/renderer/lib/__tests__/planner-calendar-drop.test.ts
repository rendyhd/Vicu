import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { plannerCalendarDropStart } from '@/lib/planner-calendar-drop'
import { plannerCalendarEvents } from '@/lib/planner-calendar'
import { taskPatch } from '@/lib/merge-patches'
import { resolveDraggedTasks } from '@/lib/task-selection'
import { withTaskDuration } from '@/lib/task-duration'
import type { Task } from '@/lib/vikunja-types'

const task = (fields: Partial<Task> = {}): Task => ({
  id: 1, project_id: 1, title: 'Drag me', start_date: '0001-01-01T00:00:00Z',
  due_date: '2026-06-12T00:00:00Z', end_date: '2026-06-13T00:00:00Z',
  description: withTaskDuration('<p>Keep these notes</p>', 90), done: false, ...fields,
}) as Task

for (const zone of ['Pacific/Auckland', 'America/New_York']) {
  describe(`Calendar row drops in ${zone}`, () => {
    const previousTZ = process.env.TZ
    beforeAll(() => { process.env.TZ = zone })
    afterAll(() => { process.env.TZ = previousTZ })

    it('places the start at the pointer on the selected local day, snapping to 15 minutes', () => {
      const gridTop = -320
      const at = (minute: number) => plannerCalendarDropStart('2026-06-10', gridTop + minute * 1.2, gridTop)
      expect(at(9 * 60 + 22)).toBe(new Date(2026, 5, 10, 9, 15).toISOString())
      expect(at(9 * 60 + 23)).toBe(new Date(2026, 5, 10, 9, 30).toISOString())
      expect(at(-100)).toBe(new Date(2026, 5, 10).toISOString())
      expect(at(1440)).toBe(new Date(2026, 5, 10, 23, 45).toISOString())
      expect(plannerCalendarDropStart('2026-06-10', NaN, gridTop)).toBeNull()
      expect(plannerCalendarDropStart('2026-06-10', 500, Infinity)).toBeNull()
    })

    it('uses live grid bounds after scrolling and does not use a source-row grab offset', () => {
      expect(plannerCalendarDropStart('2026-06-10', 400, 40)).toBe(new Date(2026, 5, 10, 5).toISOString())
      expect(plannerCalendarDropStart('2026-06-10', 400, -320)).toBe(new Date(2026, 5, 10, 10).toISOString())
    })

    it('immediately maps a card to its duration-sized preview and saves only start_date', () => {
      const original = task({ done: true })
      const changes = { start_date: plannerCalendarDropStart('2026-06-10', 720, 0)! }
      const preview = { ...original, ...changes }
      const [event] = plannerCalendarEvents([preview], new Set([1]), new Date(2026, 5, 10)).timed
      expect(event.startMinute).toBe(600)
      expect((event.endMinute - event.startMinute) * 1.2).toBe(108)
      expect(taskPatch(original, preview)).toEqual(changes)
      expect(preview).toMatchObject({ description: original.description, due_date: original.due_date, end_date: original.end_date, done: true })
      expect(original.start_date).toBe('0001-01-01T00:00:00Z')
    })

    it('uses the default block without writing duration and shares overlap columns', () => {
      const start_date = plannerCalendarDropStart('2026-06-10', 720, 0)!
      const preview = task({ start_date, description: '<p>No duration</p>' })
      const events = plannerCalendarEvents([preview, task({ id: 2, start_date })], new Set([1]), new Date(2026, 5, 10)).timed
      const event = events.find((item) => item.task.id === 1)!
      expect((event.endMinute - event.startMinute) * 1.2).toBe(36)
      expect(events.every((item) => item.columnCount === 2)).toBe(true)
      expect(taskPatch(task({ description: preview.description }), preview)).toEqual({ start_date })
    })

    it('positions by wall-clock time on DST transition days', () => {
      const day = zone === 'Pacific/Auckland' ? '2026-09-27' : '2026-03-08'
      const start = new Date(plannerCalendarDropStart(day, 9 * 60 * 1.2, 0)!)
      expect(start.getHours()).toBe(9)
      expect(start.getMinutes()).toBe(0)
    })
  })
}

it('previews and drops the same multi-selection, or just an unselected grabbed row', () => {
  const queryClient = new QueryClient()
  const first = task()
  const second = task({ id: 2 })
  queryClient.setQueryData(['tasks', 'planner'], [first, second])
  expect(resolveDraggedTasks(queryClient, first, new Set([1, 2]))).toEqual([first, second])
  expect(resolveDraggedTasks(queryClient, first, new Set([2, 3]))).toEqual([first])
  expect(resolveDraggedTasks(new QueryClient(), first, new Set([1, 2]))).toEqual([first])
})
