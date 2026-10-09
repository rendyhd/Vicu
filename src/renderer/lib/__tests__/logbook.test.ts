import { describe, expect, it } from 'vitest'
import {
  LOGBOOK_PAGE_SIZE,
  groupLogbookTasks,
  logbookHasMore,
  logbookPageParams,
  logbookTasks,
  mergeLogbookPages,
} from '../logbook'
import { filtersFor } from '@/hooks/use-filters'
import type { Task } from '../vikunja-types'

function task(id: number, extra: Partial<Task> = {}): Task {
  return { id, title: `Task ${id}`, done: true, project_id: 1, ...extra } as Task
}

const page = (from: number, count: number): Task[] => Array.from({ length: count }, (_, i) => task(from + i))

describe('Logbook paging (D-PERF-2, X-10)', () => {
  it('asks for completed tasks newest first, one page at a time, keeping nested subtasks', () => {
    const base = filtersFor({ view: 'logbook' })
    expect(base).toMatchObject({ filter: 'done = true', sort_by: 'done_at', order_by: 'desc' })

    const second = logbookPageParams(base, 2)
    expect(second).toMatchObject({
      filter: 'done = true',
      sort_by: 'done_at',
      order_by: 'desc',
      page: 2,
      per_page: LOGBOOK_PAGE_SIZE,
      keep_nested_subtasks: true,
    })
    // A page is small: the first paint is not the whole history.
    expect(LOGBOOK_PAGE_SIZE).toBeLessThanOrEqual(100)
  })

  it('has more only while the last requested page arrived full', () => {
    expect(logbookHasMore([page(1, LOGBOOK_PAGE_SIZE)])).toBe(true)
    expect(logbookHasMore([page(1, LOGBOOK_PAGE_SIZE), page(100, LOGBOOK_PAGE_SIZE)])).toBe(true)
    expect(logbookHasMore([page(1, LOGBOOK_PAGE_SIZE), page(100, 7)])).toBe(false)
    expect(logbookHasMore([page(1, 0)])).toBe(false)
    // The next page has been asked for and has not arrived: nothing more to ask for yet.
    expect(logbookHasMore([page(1, LOGBOOK_PAGE_SIZE), undefined])).toBe(false)
    expect(logbookHasMore([])).toBe(false)
  })

  it('does not decide on hidden rows: a page of metadata carriers still counts as a full page', () => {
    const carriers = Array.from({ length: LOGBOOK_PAGE_SIZE }, (_, i) =>
      task(i + 1, { description: '<!-- vicu-routine:v1:e30 -->' }))
    expect(logbookHasMore([carriers])).toBe(true)
    expect(logbookTasks([carriers])).toEqual([])
  })

  it('joins the pages in order and drops rows repeated when the set shifted between requests', () => {
    const first = [task(10), task(9), task(8)]
    const second = [task(8), task(7), task(6)] // 8 moved down because 10 was completed meanwhile
    expect(mergeLogbookPages([first, second]).map((t) => t.id)).toEqual([10, 9, 8, 7, 6])
    expect(mergeLogbookPages([first, undefined]).map((t) => t.id)).toEqual([10, 9, 8])
  })

  it('hides a completed subtask of a completed parent, wherever the parent was loaded', () => {
    const parent = task(1)
    const child = task(2, { related_tasks: { parenttask: [{ id: 1, done: true } as Task] } })
    const lone = task(3, { related_tasks: { parenttask: [{ id: 99, done: false } as Task] } })

    // The parent is on the first page, the child on the second.
    expect(logbookTasks([[parent], [child, lone]]).map((t) => t.id)).toEqual([1, 3])
    // The child alone: its embedded parent is completed, so it still nests inside it.
    expect(logbookTasks([[child]]).map((t) => t.id)).toEqual([])
    // A completed child of a reopened parent is a Logbook row of its own.
    expect(logbookTasks([[lone]]).map((t) => t.id)).toEqual([3])
  })
})

describe('Logbook day groups (card 2.9, logbook.group and logbook.time)', () => {
  const en = { locale: 'en-US', hour12: false }
  // Local wall-clock times, so the test holds in any time zone.
  const now = new Date(2026, 9, 8, 12, 0)
  const doneAt = (id: number, y: number, m: number, d: number, h: number, min: number) =>
    task(id, { done_at: new Date(y, m, d, h, min).toISOString() })

  it('groups neighbours by the completion day phrase and gives each row its completion time', () => {
    const groups = groupLogbookTasks(
      [
        doneAt(1, 2026, 9, 8, 9, 5),
        doneAt(2, 2026, 9, 8, 8, 0),
        doneAt(3, 2026, 9, 7, 17, 30),
        doneAt(4, 2026, 9, 5, 10, 0),
        doneAt(5, 2026, 8, 30, 10, 0),
        doneAt(6, 2026, 8, 2, 10, 0),
      ],
      now,
      en,
    )
    expect(groups.map((g) => g.title)).toEqual(['Today', 'Yesterday', 'Mon, Oct 5', 'September 2026'])
    expect(groups[0].rows.map((r) => [r.task.id, r.time])).toEqual([[1, '09:05'], [2, '08:00']])
    expect(groups[3].rows.map((r) => r.task.id)).toEqual([5, 6])
  })

  it('uses the 12-hour clock and counts a completion ahead of the clock as today', () => {
    const groups = groupLogbookTasks([doneAt(1, 2026, 9, 8, 15, 0)], new Date(2026, 9, 8, 14, 0), { locale: 'en-US', hour12: true })
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Today')
    expect(groups[0].rows[0].time).toBe('3:00 PM')
  })

  it('keeps a task without a completion time in the group it sits in, without a time', () => {
    const nullDone = { done_at: '0001-01-01T00:00:00Z' }
    const inside = groupLogbookTasks([doneAt(1, 2026, 9, 8, 9, 0), task(2, nullDone), doneAt(3, 2026, 9, 8, 8, 0)], now, en)
    expect(inside.map((g) => g.title)).toEqual(['Today'])
    expect(inside[0].rows.map((r) => r.time)).toEqual(['09:00', '', '08:00'])

    const first = groupLogbookTasks([task(1, nullDone), doneAt(2, 2026, 9, 8, 9, 0)], now, en)
    expect(first.map((g) => g.title)).toEqual(['', 'Today'])
  })

  it('is empty for no tasks', () => {
    expect(groupLogbookTasks([], now, en)).toEqual([])
  })
})
