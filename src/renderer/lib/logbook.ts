import { hasVicuMetadataMarker } from './metadata-tasks'
import { withoutNestedSubtasks } from './nested-subtasks'
import type { Task, TaskQueryParams } from './vikunja-types'

/**
 * The Logbook loads the completed tasks a page at a time, newest first, instead of the whole history
 * on every mount and invalidation (D-PERF-2, X-10). One page is a few screens of rows, so the first
 * paint costs one small request.
 */
export const LOGBOOK_PAGE_SIZE = 50

/**
 * The query of one Logbook page. Nested subtasks are kept in the page: hiding them needs the
 * parent, which may be on another page, so `logbookTasks` does it over the pages loaded so far.
 */
export function logbookPageParams(base: TaskQueryParams, page: number): TaskQueryParams {
  return { ...base, page, per_page: LOGBOOK_PAGE_SIZE, keep_nested_subtasks: true }
}

/** The loaded pages in order, without repeats: a task completed meanwhile shifts rows between pages. */
export function mergeLogbookPages(pages: ReadonlyArray<readonly Task[] | undefined>): Task[] {
  const seen = new Set<number>()
  const merged: Task[] = []
  for (const page of pages) {
    for (const task of page ?? []) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      merged.push(task)
    }
  }
  return merged
}

/**
 * Whether another page can be asked for: the last page requested has arrived and is full. Decided
 * on the raw page, before anything is hidden, or a page of mostly hidden rows would end the list.
 */
export function logbookHasMore(pages: ReadonlyArray<readonly Task[] | undefined>): boolean {
  const last = pages[pages.length - 1]
  return last !== undefined && last.length >= LOGBOOK_PAGE_SIZE
}

/**
 * What the Logbook shows of the pages loaded so far: implementation-detail tasks and nested
 * subtasks hidden (a completed subtask of a completed parent lives inside the parent, as before
 * paging).
 */
export function logbookTasks(pages: ReadonlyArray<readonly Task[] | undefined>): Task[] {
  const visible = mergeLogbookPages(pages).filter((task) => !hasVicuMetadataMarker(task.description))
  return withoutNestedSubtasks(visible)
}
