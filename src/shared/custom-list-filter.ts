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
 * - The collaboration and activity conditions (`assigned`, `comments`, `shared_only`,
 *   `changed_within_days`, section 3.3) also read a `CustomListContext`: who you are and which
 *   projects are shared. `customListActivity` in the fixture covers them.
 *
 * - A list's `rule` (section 3.5) is checked by `custom-list-rule.ts` after the conditions above;
 *   the `customListRule` vectors cover it.
 *
 * This file only imports its sibling helpers, so any tsconfig can include it.
 */

import { matchesProConditions, type ProListContext, type ProListTask } from './pro/list-conditions'
import { compileRule, ruleUsesLike, validateRule, type RuleTask } from './custom-list-rule'
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
  /** 'me', 'others' or 'nobody'; anything else (or absent) is no condition. */
  assigned?: string
  /** 'unread' or 'any'; anything else (or absent) is no condition. */
  comments?: string
  /** Only tasks of shared projects. */
  shared_only?: boolean
  /** Only tasks changed on the last N local days, today included; a whole number of 1 or more. */
  changed_within_days?: number
  /** A condition in Vikunja's filter language (section 3.5); absent or empty is none. */
  rule?: string
  /** Whether the rule's terms also match a task without a value for their field. */
  rule_include_nulls?: boolean
  // Pro's conditions (section 3.8), evaluated Pro on or off.
  availability?: string
  flagged?: boolean
  estimate_max?: number
  project_status?: string
  promise?: string
  person?: number[]
}

/** The fields of a Vikunja task the evaluator reads (the rule reads more, all optional). */
export interface CustomListTask extends Omit<RuleTask, 'project_id' | 'assignees'> {
  project_id: number
  done?: boolean
  due_date?: string | null
  priority?: number
  labels?: Array<{ id: number }> | null
  assignees?: Array<{ id: number }> | null
  /** Only present when the list asked for it (`expand=comment_count`). */
  comment_count?: number | null
  /** Only present when the list asked for it (`expand=is_unread`). */
  is_unread?: boolean | null
  updated?: string | null
}

/** What the collaboration conditions read besides the task (section 3.3). */
export interface CustomListContext {
  /** Your user id; null or absent while you are not known. */
  me?: number | null
  /** Whether a project is shared: its members include someone besides you. Absent: none is. */
  isShared?: (projectId: number) => boolean
  /** What Pro's conditions read (section 3.8); absent: they are no condition. */
  pro?: ProListContext
}

/** The assigned values this version knows. */
export const ASSIGNED_VALUES = ['me', 'others', 'nobody'] as const
/** The comments values this version knows. */
export const COMMENTS_VALUES = ['unread', 'any'] as const

/** `changed_within_days` when it is a condition (a whole number of 1 or more), else null. */
export function changedWithinDays(filter: CustomListFilterInput): number | null {
  const days = filter.changed_within_days
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 ? days : null
}

/** Whether the filter has any condition that reads the collaboration context. */
export function hasCollaborationCondition(filter: CustomListFilterInput): boolean {
  return (ASSIGNED_VALUES as readonly string[]).includes(filter.assigned ?? '')
    || (COMMENTS_VALUES as readonly string[]).includes(filter.comments ?? '')
    || filter.shared_only === true
}

/** Whether the filter needs `comment_count` or `is_unread` from the server. */
export function needsCommentSignals(filter: CustomListFilterInput): boolean {
  return (COMMENTS_VALUES as readonly string[]).includes(filter.comments ?? '')
}

/** The assigned, comments, shared and changed conditions of section 3.3. */
function matchesActivity(task: CustomListTask, filter: CustomListFilterInput, day: LocalDate, context: CustomListContext): boolean {
  const shared = context.isShared?.(task.project_id) ?? false
  if (filter.shared_only === true && !shared) return false

  const me = context.me ?? null
  const assignees = task.assignees ?? []
  switch (filter.assigned) {
    case 'me':
      if (!shared || me === null || !assignees.some((person) => person.id === me)) return false
      break
    case 'others':
      if (!shared || me === null || assignees.length === 0 || assignees.some((person) => person.id === me)) return false
      break
    case 'nobody':
      if (!shared || assignees.length > 0) return false
      break
  }

  switch (filter.comments) {
    case 'unread':
      if (!shared || task.is_unread !== true) return false
      break
    case 'any':
      // Comments are on every task; only the unread mark needs someone else (section 9.1).
      if (!((task.comment_count ?? 0) > 0)) return false
      break
  }

  const days = changedWithinDays(filter)
  if (days !== null) {
    const changed = localDateOf(task.updated)
    if (changed === '' || changed < addLocalDays(day, -(days - 1))) return false
  }

  return true
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

/** The list's rule as a predicate at `now` (section 3.5); every task when there is none. */
function ruleOf(filter: CustomListFilterInput, now: Date): (task: CustomListTask) => boolean {
  return compileRule(filter.rule, filter.rule_include_nulls === true, now) as (task: CustomListTask) => boolean
}

/**
 * Whether `task` belongs on the list described by `filter`, on the local date `today`.
 * `context` is read by the collaboration conditions only; without it nothing is shared. `now` is
 * the moment the rule's `now` means (by default: the current moment).
 */
export function matchesCustomList(
  task: CustomListTask,
  filter: CustomListFilterInput,
  today: EvaluationDay,
  context: CustomListContext = {},
  now: Date = new Date(),
): boolean {
  return matchesForm(task, filter, dayOf(today), context) && ruleOf(filter, now)(task)
}

/** The conditions of sections 3.1 to 3.3, without the rule. */
function matchesForm(
  task: CustomListTask,
  filter: CustomListFilterInput,
  day: LocalDate,
  context: CustomListContext,
): boolean {
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

  if (!matchesActivity(task, filter, day, context)) return false
  return matchesProConditions(task as ProListTask, filter, context.pro)
}

/** The tasks of `tasks` that match, in their original order. */
export function filterCustomList<T extends CustomListTask>(
  tasks: readonly T[],
  filter: CustomListFilterInput,
  today: EvaluationDay,
  context: CustomListContext = {},
  now: Date = new Date(),
): T[] {
  const day = dayOf(today)
  const rule = ruleOf(filter, now)
  return tasks.filter((task) => matchesForm(task, filter, day, context) && rule(task))
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
 * widens it with the today window, and `changed_within_days` adds `updated >= '<start of the
 * first local day>'`. The assigned and comments conditions stay client-side (they depend on
 * which projects are shared). Callers must still apply `filterCustomList`. Undefined when the
 * list has no server-side condition.
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

  const days = changedWithinDays(filter)
  if (days !== null) parts.push(`updated >= '${startOfLocalDayIso(-(days - 1), now)}'`)

  const base = parts.join(' && ')
  const rule = serverRule(filter)
  if (rule !== null) return base === '' ? `(${rule})` : `(${base}) && (${rule})`
  return parts.length > 0 ? base : undefined
}

/**
 * The rule when the server can be asked for it (section 3.5): valid, and without `like`, whose
 * case rules depend on the server's database. Null otherwise.
 */
function serverRule(filter: CustomListFilterInput): string | null {
  const rule = filter.rule?.trim() ?? ''
  if (rule === '' || validateRule(rule) !== null || ruleUsesLike(rule)) return null
  return rule
}

/**
 * What a list's query sends next to `filter` when the rule goes to the server: the device's zone
 * for the rule's dates, and `filter_include_nulls` from the list (section 3.5).
 */
export function customListRuleParams(filter: CustomListFilterInput): { filter_timezone?: string; filter_include_nulls?: boolean } {
  if (serverRule(filter) === null) return {}
  return {
    filter_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(filter.rule_include_nulls ? { filter_include_nulls: true } : {}),
  }
}

/** Whether the "include overdue" option has any effect for this window (the editor shows it then). */
export function windowHonorsIncludeOverdue(value: string | undefined): boolean {
  return value !== undefined && WINDOWS_WITH_OVERDUE.has(value)
}
