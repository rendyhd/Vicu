/**
 * 90-day plans (docs/cross-app-semantics-v1.md section 21.20): a project with a start and an end
 * day. Its top-level tasks are the plan's items and their subtasks the milestones, which are
 * promises like any other. What the plan view shows is worked out from the tasks and the verdicts
 * given on them; nothing about a plan's progress is stored, and no status is ever computed. Both
 * apps run the `pro.plans` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, diffLocalDays, isNoDueDate, localDateOf, type LocalDate } from '../due-dates'
import { activeVerdicts, finalVerdictOf, recordValue, type ProLedger } from './ledger'
import { ownerOf } from './groups'
import { effectiveDue, type PromiseTask } from './promises'
import { idOfProKey, PROJECT_PLAN_KEY_PREFIX } from './prefs'

export const PLAN_DEFAULT_WEEKS = 13
/** A plan longer than this is read as it is but shown with this many weeks at most. */
export const PLAN_MAX_WEEKS = 53

export interface ProjectPlan {
  start: LocalDate
  end: LocalDate
  /** The group it belongs to (its label id), or null for a plan of your own. */
  group: number | null
  /** The day it was closed, or null while it runs. */
  closed: LocalDate | null
  /** The project of the plan it carries on from, or null. */
  from: number | null
  [unknownField: string]: unknown
}

const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/
/** A real calendar day: `2026-02-30` is none. */
const isDay = (value: unknown): value is LocalDate => {
  if (typeof value !== 'string' || !LOCAL_DAY.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}
const wholeAboveZero = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

/** A plan from its stored value, or null when it is not one: both days are needed, in order. */
export function readPlan(value: unknown): ProjectPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!isDay(raw.start) || !isDay(raw.end) || raw.end < raw.start) return null
  return {
    ...raw,
    start: raw.start,
    end: raw.end,
    group: wholeAboveZero(raw.group) ? raw.group : null,
    closed: isDay(raw.closed) ? raw.closed : null,
    from: wholeAboveZero(raw.from) ? raw.from : null,
  }
}

/** The value to store: a field that is not set is left out, unknown fields stay. */
export function planValue(plan: ProjectPlan): Record<string, unknown> {
  const value: Record<string, unknown> = { ...plan }
  for (const key of ['group', 'closed', 'from'] as const) if (value[key] === null || value[key] === undefined) delete value[key]
  return value
}

/** The last day of a plan of the default length that starts on `start`. */
export function defaultPlanEnd(start: LocalDate): LocalDate {
  return addLocalDays(start, PLAN_DEFAULT_WEEKS * 7 - 1)
}

/** The plans in the synced values, by project id: open ones first by end day, then closed ones, newest first. */
export function plansOf(values: Readonly<Record<string, unknown>>): Array<{ project: number; plan: ProjectPlan }> {
  const list: Array<{ project: number; plan: ProjectPlan }> = []
  for (const [key, value] of Object.entries(values)) {
    const project = idOfProKey(key, PROJECT_PLAN_KEY_PREFIX)
    const plan = project === null ? null : readPlan(value)
    if (project !== null && plan) list.push({ project, plan })
  }
  return list.sort((a, b) => {
    const left = a.plan.closed !== null
    const right = b.plan.closed !== null
    if (left !== right) return left ? 1 : -1
    if (!left && a.plan.end !== b.plan.end) return a.plan.end < b.plan.end ? -1 : 1
    if (left && a.plan.closed !== b.plan.closed) return (a.plan.closed as string) < (b.plan.closed as string) ? 1 : -1
    return a.project - b.project
  })
}

export interface PlanWeek {
  from: LocalDate
  to: LocalDate
}

/** The plan's weeks: seven days each from its first day, the last one ending on its last day. */
export function planWeeks(plan: Pick<ProjectPlan, 'start' | 'end'>): PlanWeek[] {
  const weeks: PlanWeek[] = []
  let from = plan.start
  while (from <= plan.end && weeks.length < PLAN_MAX_WEEKS) {
    const to = addLocalDays(from, 6)
    weeks.push({ from, to: to > plan.end || weeks.length === PLAN_MAX_WEEKS - 1 ? plan.end : to })
    from = addLocalDays(from, 7)
  }
  return weeks
}

/** The week a day falls in (0 for the first), or null outside the plan. */
export function planWeekOf(plan: Pick<ProjectPlan, 'start' | 'end'>, day: LocalDate): number | null {
  if (day < plan.start || day > plan.end) return null
  return Math.min(Math.floor(diffLocalDays(plan.start, day) / 7), PLAN_MAX_WEEKS - 1)
}

export interface PlanTask extends PromiseTask {
  /** The task it is a subtask of, or null for a top-level task. */
  parent: number | null
}

/**
 * The ids of the plan's items: the tasks that are no subtask of another task of the plan. A subtask
 * whose parent is elsewhere (an item that moved on to the next plan) is an item of its own, so what
 * was delivered here stays in view.
 */
export function planItemIds(tasks: readonly PlanTask[]): Set<number> {
  const ids = new Set(tasks.map((task) => task.id))
  return new Set(tasks.filter((task) => task.parent === null || !ids.has(task.parent)).map((task) => task.id))
}

/** What happened in one week of one item: counts of facts, never a status. */
export interface PlanCell {
  /** Milestones whose date falls in the week. */
  due: number
  /** Milestones delivered in the week (late ones included). */
  delivered: number
  /** Of those, delivered late. */
  late: number
  /** Dates that moved in the week: "not yet" and "new date" verdicts. */
  slipped: number
  /** Milestones dropped in the week. */
  dropped: number
}

export interface PlanItem {
  id: number
  /** The item's owner: its own promise's, else the one all its milestones share, else nobody. */
  owner: number | null
  /** The item's task is done. */
  done: boolean
  /** Milestones that count: every one that was not dropped. */
  total: number
  delivered: number
  dropped: number
  /** Open milestones whose date is before today. */
  overdue: number
  /** The open milestone that is due first (none last, then id), or null. */
  next: number | null
  /** The item's milestones, in due order (none last), then id. */
  milestones: number[]
  /** One cell per week of the plan. */
  weeks: PlanCell[]
}

export interface PlanView {
  weeks: PlanWeek[]
  /** The week today falls in (0 for the first), or null before the plan starts or after it ends. */
  week: number | null
  items: PlanItem[]
  total: number
  delivered: number
  overdue: number
}

export interface PlanViewInput {
  plan: Pick<ProjectPlan, 'start' | 'end'>
  /** The project's tasks, open and done, in the order the items are shown in. */
  tasks: readonly PlanTask[]
  ledger: ProLedger | null | undefined
  today: LocalDate
}

const emptyCell = (): PlanCell => ({ due: 0, delivered: 0, late: 0, slipped: 0, dropped: 0 })

/**
 * The plan view (section 21.20): one row per item, one cell per week. A milestone is a subtask of
 * an item; an item without subtasks is its own one milestone. A milestone is delivered by a final
 * verdict of delivered, late or done by you, or by its task being done; a dropped one leaves the
 * count.
 */
export function planView(input: PlanViewInput): PlanView {
  const { plan, ledger, today } = input
  const weeks = planWeeks(plan)
  const itemIds = planItemIds(input.tasks)
  const children = new Map<number, PlanTask[]>()
  for (const task of input.tasks) {
    // A milestone is a direct subtask of an item; what hangs under a milestone is its own detail.
    if (task.parent !== null && !itemIds.has(task.id) && itemIds.has(task.parent)) children.set(task.parent, [...(children.get(task.parent) ?? []), task])
  }
  const items: PlanItem[] = []
  for (const task of input.tasks) {
    if (!itemIds.has(task.id)) continue
    const own = children.get(task.id) ?? []
    const milestones = own.length ? own : [task]
    const cells = weeks.map(emptyCell)
    const at = (day: LocalDate | null): PlanCell | null => {
      const index = day === null ? null : planWeekOf(plan, day)
      return index === null ? null : cells[index]
    }
    const rows: Array<{ id: number; due: LocalDate | null; open: boolean }> = []
    const owners = new Set<number | null>()
    let delivered = 0
    let dropped = 0
    let overdue = 0
    for (const milestone of milestones) {
      const promise = recordValue(ledger?.promises, milestone.id)
      if (own.length && promise) owners.add(ownerOf(promise))
      const final = finalVerdictOf(promise)
      const due = promise ? effectiveDue(milestone, promise) : isNoDueDate(milestone.due_date) ? null : localDateOf(milestone.due_date)
      for (const verdict of activeVerdicts(promise)) {
        if (verdict.kind !== 'not_yet' && verdict.kind !== 'renegotiated') continue
        const cell = at(localDateOf(verdict.at))
        if (cell) cell.slipped++
      }
      if (final?.kind === 'dropped') {
        dropped++
        const cell = at(localDateOf(final.at))
        if (cell) cell.dropped++
        rows.push({ id: milestone.id, due, open: false })
        continue
      }
      const dueCell = at(due)
      if (dueCell) dueCell.due++
      const isDelivered = final ? final.kind === 'delivered' || final.kind === 'late' || final.kind === 'taken_over' : milestone.done === true
      if (isDelivered) {
        delivered++
        const day = final ? localDateOf(final.at) : milestone.done_at && !isNoDueDate(milestone.done_at) ? localDateOf(milestone.done_at) : null
        const cell = at(day)
        if (cell) {
          cell.delivered++
          if (final?.kind === 'late') cell.late++
        }
      } else if (due !== null && due < today) overdue++
      rows.push({ id: milestone.id, due, open: !isDelivered })
    }
    rows.sort((a, b) => (a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1))
    const ownPromise = recordValue(ledger?.promises, task.id)
    const shared = owners.size === 1 ? [...owners][0] : null
    items.push({
      id: task.id,
      owner: ownPromise ? ownerOf(ownPromise) : shared,
      done: task.done === true,
      total: milestones.length - dropped,
      delivered,
      dropped,
      overdue,
      next: rows.find((row) => row.open)?.id ?? null,
      milestones: rows.map((row) => row.id),
      weeks: cells,
    })
  }
  return {
    weeks,
    week: planWeekOf(plan, today),
    items,
    total: items.reduce((sum, item) => sum + item.total, 0),
    delivered: items.reduce((sum, item) => sum + item.delivered, 0),
    overdue: items.reduce((sum, item) => sum + item.overdue, 0),
  }
}

/** The plan closed on `today`. */
export function closePlan(plan: ProjectPlan, today: LocalDate): ProjectPlan {
  return { ...plan, closed: today }
}

/**
 * The plan that carries on from one that closes: it starts the day after the old one ended, or
 * today when that has passed, runs the default length, keeps the group and names where it came from.
 */
export function nextPlan(plan: ProjectPlan, project: number, today: LocalDate): ProjectPlan {
  const after = addLocalDays(plan.end, 1)
  const start = after < today ? today : after
  return { start, end: defaultPlanEnd(start), group: plan.group, closed: null, from: project }
}

/**
 * What moves to the next plan: the items that are not done, each with its milestones that are not
 * done. Tasks move, so their promises and history go with them.
 */
export function carryOver(tasks: readonly PlanTask[]): { items: number[]; milestones: number[] } {
  const itemIds = planItemIds(tasks)
  const items = tasks.filter((task) => itemIds.has(task.id) && task.done !== true).map((task) => task.id)
  const open = new Set(items)
  const milestones = tasks.filter((task) => !itemIds.has(task.id) && task.parent !== null && open.has(task.parent) && task.done !== true).map((task) => task.id)
  return { items, milestones }
}
