/**
 * The one evaluator for custom lists, shared by the main window, Quick View (main process) and
 * anything else that applies a list. Implements section 3 of docs/cross-app-semantics-v1.md;
 * Android implements the same contract and both apps run `customLists` from
 * test-fixtures/cross-app-semantics-v1.json against it.
 *
 * - Dates are local calendar dates (`YYYY-MM-DD`) and are compared as strings; never instants.
 * - Weeks start on Monday, so `this_week` ends on Sunday (on a Sunday: today only).
 * - `include_overdue` (absent = true) only affects `today`, `this_week` and `this_month`.
 * - Every condition is evaluated on the full task set, before nested subtasks are hidden.
 * - Server filter strings are a superset of the exact window built from local-day boundaries;
 *   the exact rule is always applied client-side with `matchesCustomList`.
 *
 * This file only imports its sibling due-date helpers, so any tsconfig can include it.
 */

import {
  addLocalDays,
  diffLocalDays,
  endOfMonth,
  endOfWeek,
  localDateOf,
  startOfLocalDayIso,
  toLocalDate,
  type LocalDate,
} from './due-dates'

/** Vikunja's null date. Duplicated here on purpose, like in due-dates.ts. */
const NULL_DUE_DATE = '0001-01-01T00:00:00Z'

/** The windows `include_overdue` applies to. */
const WINDOWS_WITH_OVERDUE: ReadonlySet<string> = new Set(['today', 'this_week', 'this_month'])

/** The conditions of a custom list, in the shape both the synced list and Quick View use. */
export interface CustomListFilterInput {
  /**
   * all, overdue, today, this_week, this_month, has_due_date or no_due_date. Anything else (a
   * value from a newer app) means no date condition.
   */
  due_date_filter?: string
  /** Absent means true. */
  include_overdue?: boolean
  include_done?: boolean
  project_ids?: number[] | null
  /** 'exclude' removes the listed projects; anything else is 'include'. */
  project_filter_mode?: string
  include_today_all_projects?: boolean
  priority_filter?: number[] | null
  label_ids?: number[] | null
}

/** The fields of a Vikunja task the evaluator reads. */
export interface CustomListTask {
  project_id: number
  done?: boolean
  due_date?: string | null
  priority?: number
  labels?: Array<{ id: number }> | null
}

/** The local calendar date an evaluation runs for. A Date is read in the process time zone. */
export type EvaluationDay = LocalDate | Date

function dayOf(today: EvaluationDay): LocalDate {
  return typeof today === 'string' ? today : toLocalDate(today)
}

/** Whether the filter also keeps overdue tasks in the today / this week / this month windows. */
export function includesOverdue(filter: CustomListFilterInput): boolean {
  return filter.include_overdue !== false
}

/**
 * Whether a local due date (`''` for none) falls in a date window on `today`. `includeOverdue`
 * is ignored by the windows it does not apply to.
 */
export function inDateWindow(
  due: LocalDate,
  window: string | undefined,
  includeOverdue: boolean,
  today: LocalDate,
): boolean {
  switch (window) {
    case 'overdue':
      return due !== '' && due < today
    case 'today':
      return due !== '' && (due === today || (includeOverdue && due < today))
    case 'this_week':
      return due !== '' && ((due >= today && due <= endOfWeek(today)) || (includeOverdue && due < today))
    case 'this_month':
      return due !== '' && ((due >= today && due <= endOfMonth(today)) || (includeOverdue && due < today))
    case 'has_due_date':
      return due !== ''
    case 'no_due_date':
      return due === ''
    default:
      // 'all', absent, or a window this version does not know.
      return true
  }
}

/** Whether `task` belongs on the list described by `filter`, on the local date `today`. */
export function matchesCustomList(task: CustomListTask, filter: CustomListFilterInput, today: EvaluationDay): boolean {
  const day = dayOf(today)
  const overdueToo = includesOverdue(filter)

  if (!filter.include_done && task.done) return false

  const due = localDateOf(task.due_date)
  if (!inDateWindow(due, filter.due_date_filter, overdueToo, day)) return false

  const projectIds = filter.project_ids ?? []
  if (projectIds.length > 0) {
    const listed = projectIds.includes(task.project_id)
    const projectOk = filter.project_filter_mode === 'exclude' ? !listed : listed
    // "Today from all projects" brings back anything in the today window, whatever its project.
    if (!projectOk && !(filter.include_today_all_projects && inDateWindow(due, 'today', overdueToo, day))) {
      return false
    }
  }

  const priorities = filter.priority_filter ?? []
  if (priorities.length > 0 && !priorities.includes(task.priority ?? 0)) return false

  const labelIds = filter.label_ids ?? []
  if (labelIds.length > 0) {
    const taskLabels = task.labels ?? []
    if (!labelIds.some((id) => taskLabels.some((label) => label.id === id))) return false
  }

  return true
}

/** The tasks of `tasks` that match, in their original order. */
export function filterCustomList<T extends CustomListTask>(
  tasks: readonly T[],
  filter: CustomListFilterInput,
  today: EvaluationDay,
): T[] {
  const day = dayOf(today)
  return tasks.filter((task) => matchesCustomList(task, filter, day))
}

// --- Server filter ----------------------------------------------------------------------

/**
 * The server-side clause for a date window: a superset of `inDateWindow` built from local-day
 * boundaries (`due_date < '<start of the day after the window end>'`). Null when the window
 * has no date condition.
 */
function dateWindowClause(window: string | undefined, includeOverdue: boolean, now: Date): string | null {
  const today = toLocalDate(now)
  const notNull = `due_date != '${NULL_DUE_DATE}'`
  // Start of the day after the window's last day, as a UTC instant.
  const before = (lastDay: LocalDate): string => startOfLocalDayIso(diffLocalDays(today, addLocalDays(lastDay, 1)), now)

  const bounded = (lastDay: LocalDate): string =>
    includeOverdue
      ? `due_date < '${before(lastDay)}' && ${notNull}`
      : `due_date >= '${startOfLocalDayIso(0, now)}' && due_date < '${before(lastDay)}'`

  switch (window) {
    case 'overdue':
      return `due_date < '${startOfLocalDayIso(0, now)}' && ${notNull}`
    case 'today':
      return bounded(today)
    case 'this_week':
      return bounded(endOfWeek(today))
    case 'this_month':
      return bounded(endOfMonth(today))
    case 'has_due_date':
      return notNull
    case 'no_due_date':
      return `due_date = '${NULL_DUE_DATE}'`
    default:
      return null
  }
}

/**
 * The Vikunja `filter` string for a custom list. It never excludes a task the evaluator would
 * accept: the project clause is only added for include mode, and "today from all projects"
 * widens it with the today window. Callers must still apply `filterCustomList`. Undefined
 * when the list has no server-side condition.
 */
export function buildCustomListServerFilter(filter: CustomListFilterInput, now: Date = new Date()): string | undefined {
  const parts: string[] = []
  if (!filter.include_done) parts.push('done = false')

  const projectIds = filter.project_ids ?? []
  if (projectIds.length > 0 && filter.project_filter_mode !== 'exclude') {
    const projectClause = projectIds.length === 1
      ? `project_id = ${projectIds[0]}`
      : `(${projectIds.map((id) => `project_id = ${id}`).join(' || ')})`
    if (filter.include_today_all_projects) {
      const todayClause = dateWindowClause('today', includesOverdue(filter), now)
      parts.push(`(${projectClause} || (${todayClause}))`)
    } else {
      parts.push(projectClause)
    }
  }

  const dateClause = dateWindowClause(filter.due_date_filter, includesOverdue(filter), now)
  if (dateClause) parts.push(dateClause)

  return parts.length > 0 ? parts.join(' && ') : undefined
}

/** Whether the "include overdue" option has any effect for this window (the editor shows it then). */
export function windowHonorsIncludeOverdue(value: string | undefined): boolean {
  return value !== undefined && WINDOWS_WITH_OVERDUE.has(value)
}
