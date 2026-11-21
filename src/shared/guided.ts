/**
 * Guided organizing (docs/cross-app-semantics-v1.md section 14): the queues the sessions walk
 * through, a project's health line, how long ago something was, the weekly review's steps and Ask's
 * agenda. Pinned by the `guided` vectors of test-fixtures/cross-app-semantics-v1.json; Vicu mobile
 * implements the same rules (`Guided.kt`).
 *
 * Pure: the world (tasks, projects, the Inbox, today's local date, the review settings and the task
 * order entries) is passed in, and day arithmetic is done on local dates.
 */
import { addLocalDays, diffLocalDays, isNoDueDate, localDateOf, startOfLocalDay, toLocalDate, type LocalDate } from './due-dates'
import { isHiddenTask } from './hidden-tasks'
import { computeStatus, parseReviewFooter } from './review-metadata'
import { readWeeklyReviewLast } from './synced-prefs'
import { resolveTaskOrder, sortTasksByOrder } from './task-order'

/** The numbers of the `guided.limits` block. */
export const GUIDED_LIMITS = {
  waiting_days: 60,
  waiting_max: 30,
  review_untouched_days: 30,
  look_ahead_days: 14,
  weekly_due_days: 7,
  inbox_age_days: 7,
} as const

/** The card sessions (14.2); the project review session is `review`. */
export type GuidedQueueId = 'inbox' | 'overdue' | 'waiting'
export type GuidedSessionId = GuidedQueueId | 'review'

/** The session's name, as the card header and the suggestion request (`list`) say it. */
export const GUIDED_QUEUE_NAMES: Record<GuidedQueueId, string> = { inbox: 'Inbox', overdue: 'Overdue', waiting: 'Waiting' }

/** The fields of a task the rules read (the Vikunja task shape). */
export interface GuidedTask {
  id: number
  title?: string | null
  description?: string | null
  done?: boolean | null
  done_at?: string | null
  due_date?: string | null
  project_id: number
  position?: number | null
  priority?: number | null
  created?: string | null
  updated?: string | null
  repeat_after?: number | null
  repeat_mode?: number | null
}

/** The fields of a project the rules read (the Vikunja project shape). */
export interface GuidedProject {
  id: number
  title: string
  description?: string | null
  parent_project_id?: number | null
  is_archived?: boolean | null
  max_permission?: number | null
}

export interface GuidedReviewSettings {
  enabled: boolean
  defaultCadence: number
  excludeInbox: boolean
}

export interface GuidedWorldInput<T extends GuidedTask = GuidedTask> {
  tasks: readonly T[]
  projects: readonly GuidedProject[]
  /** The Inbox project, or 0 / null when none is chosen. */
  inboxId: number | null
  today: LocalDate
  review: GuidedReviewSettings
  /** The synced preference values the task order is read from (section 12.3). */
  orderValues?: Readonly<Record<string, unknown>>
  /** A project's permission (section 9.1); its `max_permission` when not given (unknown: 1). */
  permission?: (project: GuidedProject) => number
  /** Work and Personal (section 22.4): the projects the mode lists; the review queue holds only those. Null: all. */
  reviewScope?: ReadonlySet<number> | null
}

/**
 * One account's tasks and projects at one moment, as the guided rules read them. Hidden tasks
 * (section 10.1) are left out here.
 */
export class GuidedWorld<T extends GuidedTask = GuidedTask> {
  readonly tasks: readonly T[]
  readonly projects: readonly GuidedProject[]
  readonly inboxId: number | null
  readonly today: LocalDate
  readonly review: GuidedReviewSettings
  readonly orderValues: Readonly<Record<string, unknown>>
  readonly reviewScope: ReadonlySet<number> | null
  private readonly projectById: Map<number, GuidedProject>
  private readonly permissionOf: (project: GuidedProject) => number

  constructor(input: GuidedWorldInput<T>) {
    this.tasks = input.tasks.filter((task) => !isHiddenTask(task.description))
    this.projects = input.projects
    this.inboxId = input.inboxId ? input.inboxId : null
    this.today = input.today
    this.review = input.review
    this.orderValues = input.orderValues ?? {}
    this.reviewScope = input.reviewScope ?? null
    this.projectById = new Map(input.projects.map((project) => [project.id, project]))
    this.permissionOf = input.permission ?? ((project) => (typeof project.max_permission === 'number' ? project.max_permission : 1))
  }

  project(id: number): GuidedProject | undefined {
    return this.projectById.get(id)
  }

  task(id: number): T | undefined {
    return this.tasks.find((task) => task.id === id)
  }

  /** Archived itself or below an archived project. */
  isArchived(projectId: number): boolean {
    const seen = new Set<number>()
    let current: number | null | undefined = projectId
    while (current && !seen.has(current)) {
      seen.add(current)
      const project = this.projectById.get(current)
      if (!project) return false
      if (project.is_archived) return true
      current = project.parent_project_id
    }
    return false
  }

  /** The person can change the project's tasks: known, not archived, permission above 0. */
  canChange(projectId: number): boolean {
    const project = this.projectById.get(projectId)
    return !!project && !this.isArchived(projectId) && this.permissionOf(project) !== 0
  }

  /** A project's titles from the top, joined with ` / `. */
  path(projectId: number): string {
    const titles: string[] = []
    const seen = new Set<number>()
    let current: number | null | undefined = projectId
    while (current && !seen.has(current)) {
      seen.add(current)
      const project = this.projectById.get(current)
      if (!project) break
      titles.unshift(project.title)
      current = project.parent_project_id
    }
    return titles.join(' / ')
  }

  /** The task order a project's tasks are shown in (section 12.3). */
  orderOf(projectId: number): string {
    return resolveTaskOrder(projectId, (id) => this.projectById.get(id)?.parent_project_id, this.orderValues)
  }

  /** `age_days` (14.1): today minus the local date of `created`, or null. */
  ageDays(task: GuidedTask): number | null {
    return daysSince(task.created, this.today)
  }

  /** `untouched_days` (14.1): today minus the local date of `updated`, or null. */
  untouchedDays(task: GuidedTask): number | null {
    return daysSince(task.updated, this.today)
  }
}

/** The instant of a server timestamp, or null when it is missing, unreadable or the null date. */
function instantOf(value: string | null | undefined): number | null {
  if (!value || isNoDueDate(value)) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Today minus the local date of a server timestamp, or null when there is none. */
export function daysSince(timestamp: string | null | undefined, today: LocalDate): number | null {
  const at = instantOf(timestamp)
  return at === null ? null : diffLocalDays(toLocalDate(new Date(at)), today)
}

const isOpen = (task: GuidedTask): boolean => task.done !== true
const repeats = (task: GuidedTask): boolean => (task.repeat_after ?? 0) > 0 || task.repeat_mode === 1

/** Overdue (section 2): a due date whose local date is before today. */
function isOverdueOn(task: GuidedTask, today: LocalDate): boolean {
  const day = localDateOf(task.due_date)
  return day !== '' && day < today
}

/** The due instant, for ordering; tasks without one never reach a comparison that needs it. */
const dueMs = (task: GuidedTask): number => instantOf(task.due_date) ?? Number.POSITIVE_INFINITY

/** By a number, the highest first; ties by id. */
function byDaysThenId<T extends GuidedTask>(entries: Array<{ task: T; days: number }>): T[] {
  return entries.sort((a, b) => b.days - a.days || a.task.id - b.task.id).map((entry) => entry.task)
}

/** Plain `<` on the lowercased text (UTF-16 code units), as the contract compares paths. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// --- Queues (14.2) ---------------------------------------------------------------------------

/** Open tasks of the Inbox project, in the Inbox's task order. */
export function inboxQueue<T extends GuidedTask>(world: GuidedWorld<T>): number[] {
  const inbox = world.inboxId
  if (!inbox || !world.canChange(inbox)) return []
  const open = world.tasks.filter((task) => isOpen(task) && task.project_id === inbox)
  return sortTasksByOrder(open, world.orderOf(inbox)).map((task) => task.id)
}

/** Open overdue tasks the person can change, the oldest due date first; ties by id. */
export function overdueQueue<T extends GuidedTask>(world: GuidedWorld<T>): number[] {
  return world.tasks
    .filter((task) => isOpen(task) && world.canChange(task.project_id) && isOverdueOn(task, world.today))
    .sort((a, b) => dueMs(a) - dueMs(b) || a.id - b.id)
    .map((task) => task.id)
}

/**
 * Open undated, non-repeating tasks outside the Inbox untouched for `waiting_days` or more, the
 * longest untouched first; at most `waiting_max`.
 */
export function waitingQueue<T extends GuidedTask>(world: GuidedWorld<T>): number[] {
  const entries: Array<{ task: T; days: number }> = []
  for (const task of world.tasks) {
    if (!isOpen(task) || task.project_id === world.inboxId || !world.canChange(task.project_id)) continue
    if (!isNoDueDate(task.due_date) || repeats(task)) continue
    const days = world.untouchedDays(task)
    if (days !== null && days >= GUIDED_LIMITS.waiting_days) entries.push({ task, days })
  }
  return byDaysThenId(entries).slice(0, GUIDED_LIMITS.waiting_max).map((task) => task.id)
}

export function guidedQueue<T extends GuidedTask>(queue: GuidedQueueId, world: GuidedWorld<T>): number[] {
  switch (queue) {
    case 'inbox':
      return inboxQueue(world)
    case 'overdue':
      return overdueQueue(world)
    case 'waiting':
      return waitingQueue(world)
  }
}

/**
 * The projects of the review session (14.4): due for review (section 4), not archived, changeable,
 * without the Inbox when reviews leave it out. Never reviewed first, then the fewest days until
 * due, then the path lowercased, then id. Empty while reviews are off.
 */
export function reviewQueue<T extends GuidedTask>(world: GuidedWorld<T>): number[] {
  if (!world.review.enabled) return []
  const now = startOfLocalDay(world.today)
  return world.projects
    .filter((project) => (world.reviewScope === null || world.reviewScope.has(project.id)) && world.canChange(project.id) && !(world.review.excludeInbox && project.id === world.inboxId))
    .map((project) => ({ project, status: computeStatus(parseReviewFooter(project.description), world.review.defaultCadence, now) }))
    .filter(({ status }) => status.metadata.state !== 'excluded' && status.isOverdue)
    .map((entry) => ({ ...entry, path: world.path(entry.project.id).toLowerCase() }))
    .sort((a, b) => {
      const never = (a.status.daysUntilDue === null ? 0 : 1) - (b.status.daysUntilDue === null ? 0 : 1)
      return never || (a.status.daysUntilDue ?? 0) - (b.status.daysUntilDue ?? 0) || compareText(a.path, b.path) || a.project.id - b.project.id
    })
    .map(({ project }) => project.id)
}

// --- Health (14.5) ---------------------------------------------------------------------------

export interface ProjectHealth {
  open: number
  untouched: number
  overdue: number
  scheduled: boolean
  lastDoneDays: number | null
  /** Its untouched open tasks, the longest untouched first (14.4, step 3). */
  untouchedIds: number[]
  /** The first open task in the project's task order: the next step offered without a model. */
  firstOpen: number | null
}

/** A project's health from its own tasks (a subproject's are its own). */
export function projectHealth<T extends GuidedTask>(world: GuidedWorld<T>, projectId: number): ProjectHealth {
  const own = world.tasks.filter((task) => task.project_id === projectId)
  const open = own.filter(isOpen)
  const untouched: Array<{ task: T; days: number }> = []
  for (const task of open) {
    const days = world.untouchedDays(task)
    if (days !== null && days >= GUIDED_LIMITS.review_untouched_days) untouched.push({ task, days })
  }
  let lastDoneAt: number | null = null
  for (const task of own) {
    if (task.done !== true) continue
    const at = instantOf(task.done_at)
    if (at !== null && (lastDoneAt === null || at > lastDoneAt)) lastDoneAt = at
  }
  return {
    open: open.length,
    untouched: untouched.length,
    overdue: open.filter((task) => isOverdueOn(task, world.today)).length,
    scheduled: open.some((task) => {
      const day = localDateOf(task.due_date)
      return day !== '' && day >= world.today
    }),
    lastDoneDays: lastDoneAt === null ? null : diffLocalDays(toLocalDate(new Date(lastDoneAt)), world.today),
    untouchedIds: byDaysThenId(untouched).map((task) => task.id),
    firstOpen: sortTasksByOrder(open, world.orderOf(projectId))[0]?.id ?? null,
  }
}

/** The health line: the parts of 14.5 joined with ` · `. */
export function healthLine(health: ProjectHealth): string {
  const parts = [health.open === 0 ? 'No open tasks' : `${health.open} open`]
  if (health.untouched > 0) parts.push(`${health.untouched} untouched for ${GUIDED_LIMITS.review_untouched_days}+ days`)
  if (health.overdue > 0) parts.push(`${health.overdue} overdue`)
  if (health.open > 0 && !health.scheduled) parts.push('nothing scheduled')
  if (health.lastDoneDays !== null) parts.push(`last done ${ago(health.lastDoneDays)}`)
  return parts.join(' · ')
}

// --- How long ago (14.6) ---------------------------------------------------------------------

export function ago(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 730) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

/** "Added 3 weeks ago" on a card, or null without a created date. */
export function addedAgo(task: GuidedTask, today: LocalDate): string | null {
  const days = daysSince(task.created, today)
  return days === null ? null : `Added ${ago(days)}`
}

// --- Weekly review (14.7) --------------------------------------------------------------------

export type WeeklyStepId = 'inbox' | 'mind' | 'done' | 'overdue' | 'upcoming' | 'review' | 'waiting'

export interface WeeklyStep {
  id: WeeklyStepId
  title: string
  /** Null for `mind`. */
  count: number | null
  /** The tasks `done` and `upcoming` show. */
  ids: number[]
}

/** Tasks completed in the last 7 days (local), outside archived projects, the newest first. */
export function recentlyDone<T extends GuidedTask>(world: GuidedWorld<T>): T[] {
  const since = addLocalDays(world.today, -6)
  const entries: Array<{ task: T; at: number }> = []
  for (const task of world.tasks) {
    if (task.done !== true || world.isArchived(task.project_id)) continue
    const at = instantOf(task.done_at)
    if (at !== null && toLocalDate(new Date(at)) >= since) entries.push({ task, at })
  }
  return entries.sort((a, b) => b.at - a.at || a.task.id - b.task.id).map((entry) => entry.task)
}

/** Open tasks due from tomorrow to today + `look_ahead_days`, outside archived projects, by due date then id. */
export function lookAhead<T extends GuidedTask>(world: GuidedWorld<T>): T[] {
  const last = addLocalDays(world.today, GUIDED_LIMITS.look_ahead_days)
  return world.tasks
    .filter((task) => {
      if (!isOpen(task) || world.isArchived(task.project_id)) return false
      const day = localDateOf(task.due_date)
      return day !== '' && day > world.today && day <= last
    })
    .sort((a, b) => dueMs(a) - dueMs(b) || a.id - b.id)
}

export const WEEKLY_STEP_TITLES: Record<WeeklyStepId, string> = {
  inbox: 'Sort the Inbox',
  mind: 'Anything on your mind?',
  done: 'Look back',
  overdue: 'Overdue',
  upcoming: 'Look ahead',
  review: 'Review projects',
  waiting: 'Waiting a long time',
}

/** The checklist in GTD order; `review` only while reviews are on. */
export function weeklySteps<T extends GuidedTask>(world: GuidedWorld<T>): WeeklyStep[] {
  const step = (id: WeeklyStepId, count: number | null, ids: number[] = []): WeeklyStep => ({ id, title: WEEKLY_STEP_TITLES[id], count, ids })
  const done = recentlyDone(world).map((task) => task.id)
  const ahead = lookAhead(world).map((task) => task.id)
  const steps = [
    step('inbox', inboxQueue(world).length),
    step('mind', null),
    step('done', done.length, done),
    step('overdue', overdueQueue(world).length),
    step('upcoming', ahead.length, ahead),
  ]
  if (world.review.enabled) steps.push(step('review', reviewQueue(world).length))
  steps.push(step('waiting', waitingQueue(world).length))
  return steps
}

/** Days since the last weekly review (`weekly_review.last`), or null when it was never done or cannot be read. */
export function weeklyReviewAge(last: unknown, today: LocalDate): number | null {
  const date = readWeeklyReviewLast(last)
  return date === null ? null : diffLocalDays(date, today)
}

/** Due when never done, unreadable, or at least `weekly_due_days` days before today. */
export function isWeeklyReviewDue(last: unknown, today: LocalDate): boolean {
  const age = weeklyReviewAge(last, today)
  return age === null || age >= GUIDED_LIMITS.weekly_due_days
}

// --- Ask's agenda (14.8) ---------------------------------------------------------------------

export type AgendaItemId = 'inbox' | 'overdue' | 'review' | 'weekly'

export interface AgendaItem {
  id: AgendaItemId
  title: string
  /** Null for `weekly`. */
  count: number | null
  detail: string | null
}

export function askAgenda<T extends GuidedTask>(world: GuidedWorld<T>, weeklyReviewLast: unknown): AgendaItem[] {
  const items: AgendaItem[] = []
  const inbox = inboxQueue(world)
  if (inbox.length > 0) {
    const waiting = inbox.filter((id) => {
      const task = world.task(id)
      const age = task ? world.ageDays(task) : null
      return age !== null && age >= GUIDED_LIMITS.inbox_age_days
    }).length
    items.push({ id: 'inbox', title: 'Sort the Inbox', count: inbox.length, detail: waiting > 0 ? `${waiting} waiting over a week` : null })
  }
  const overdue = overdueQueue(world)
  if (overdue.length > 0) items.push({ id: 'overdue', title: 'Sort out overdue', count: overdue.length, detail: null })
  const review = reviewQueue(world)
  if (review.length > 0) items.push({ id: 'review', title: 'Review projects', count: review.length, detail: null })
  if (isWeeklyReviewDue(weeklyReviewLast, world.today)) {
    const age = weeklyReviewAge(weeklyReviewLast, world.today)
    items.push({ id: 'weekly', title: 'Weekly review', count: null, detail: age === null ? 'Not done yet' : `Last done ${ago(age)}` })
  }
  return items
}
