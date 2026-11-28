// A project's Completed row (docs/cross-app-semantics-v1.md section 12.6): the query, the count and
// the order of the done tasks a project's list ends with while `projects.show_done` is on. Pure;
// the React side is hooks/use-project-completed.ts and components/projects/ProjectCompletedRow.tsx.

import { isNullDate } from './date-utils'
import { hasVicuMetadataMarker } from './metadata-tasks'
import { mergeLogbookPages } from './logbook'
import type { Task, TaskQueryParams } from './vikunja-types'
import type { WorkMode, WorkScope } from '../../shared/work-scope'

/** The done tasks are listed 20 at a time, with "Show more". */
export const PROJECT_DONE_PAGE_SIZE = 20

/** The server filter of a project's own done tasks (not its subprojects'), with the mode's clause (22.9). */
export function projectDoneFilter(projectId: number, workClause: string | null = null): string {
  const base = `done = true && project = ${projectId}`
  return workClause ? `${base} && ${workClause}` : base
}

/**
 * One page of a project's done tasks, newest completion first (`done_at`, then the higher id).
 * Subtasks are kept as rows of their own, so the rows add up to the count.
 */
export function projectDonePageParams(projectId: number, workClause: string | null, page: number): TaskQueryParams {
  return {
    filter: projectDoneFilter(projectId, workClause),
    sort_by: ['done_at', 'id'],
    order_by: ['desc', 'desc'],
    page,
    per_page: PROJECT_DONE_PAGE_SIZE,
    keep_nested_subtasks: true,
  }
}

/** Whether another page can be asked for: the last one has arrived and is full (decided on the raw page). */
export function projectDoneHasMore(pages: ReadonlyArray<readonly Task[] | undefined>): boolean {
  const last = pages[pages.length - 1]
  return last !== undefined && last.length >= PROJECT_DONE_PAGE_SIZE
}

function doneAtMs(task: Task): number {
  if (isNullDate(task.done_at)) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(task.done_at)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/** Newest completion first, then the higher id; a task without a completion time goes last. */
export function byCompletion(a: Task, b: Task): number {
  const diff = doneAtMs(b) - doneAtMs(a)
  if (diff !== 0 && !Number.isNaN(diff)) return diff > 0 ? 1 : -1
  return b.id - a.id
}

/**
 * The rows of the loaded pages: without repeats, without hidden tasks (10.1), only tasks still done
 * (a row reopened here leaves at once and shows in the open list above), without the ids the open
 * list above already shows (a row held there after its completion), newest completion first.
 */
export function projectDoneRows(
  pages: ReadonlyArray<readonly Task[] | undefined>,
  shownAbove: ReadonlySet<number> = new Set(),
): Task[] {
  return mergeLogbookPages(pages)
    .filter((task) => task.done && !hasVicuMetadataMarker(task.description) && !shownAbove.has(task.id))
    .sort(byCompletion)
}

/**
 * How the count of a project's done tasks follows the Work and Personal mode (section 22), from
 * server totals only: every done task of the project, none, only those with the work label, or all
 * but those. A task is work when its project is or it carries the work label (22.3).
 */
export type ProjectDoneCountPlan =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'labelled'; label: number }
  | { kind: 'allButLabelled'; label: number }

export function projectDoneCountPlan(projectId: number, scope: WorkScope, mode: WorkMode): ProjectDoneCountPlan {
  if (mode === 'all') return { kind: 'all' }
  const projectIsWork = scope.projects.has(projectId)
  if (mode === 'work') {
    if (projectIsWork) return { kind: 'all' }
    return scope.label !== null ? { kind: 'labelled', label: scope.label } : { kind: 'none' }
  }
  if (projectIsWork) return { kind: 'none' }
  return scope.label !== null ? { kind: 'allButLabelled', label: scope.label } : { kind: 'all' }
}

/** The filter of the done tasks of a project that carry a label (the work label). */
export function projectDoneLabelFilter(projectId: number, label: number): string {
  return `${projectDoneFilter(projectId)} && labels = ${label}`
}

/**
 * The count of the plan from its totals: `all` is every done task of the project (hidden carriers
 * excluded), `labelled` those with the work label. Undefined while a total it needs is unknown.
 */
export function projectDoneCount(plan: ProjectDoneCountPlan, all: number | undefined, labelled: number | undefined): number | undefined {
  switch (plan.kind) {
    case 'none':
      return 0
    case 'all':
      return all
    case 'labelled':
      return labelled
    case 'allButLabelled':
      return all === undefined || labelled === undefined ? undefined : Math.max(0, all - labelled)
  }
}
