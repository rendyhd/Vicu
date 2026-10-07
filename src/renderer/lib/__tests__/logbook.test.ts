import { describe, expect, it } from 'vitest'
import {
  LOGBOOK_PAGE_SIZE,
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
