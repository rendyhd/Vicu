// Time blocks (docs/cross-app-semantics-v1.md section 16), one definition for main and renderer, the
// same as Android's TimeBlocks. A block is the task's own start_date and end_date; anything else in
// those fields is not a block and is left alone. Pure: no Electron, no DOM, and the clock is passed in.

import {
  addLocalDays,
  dateOnlyDue,
  diffLocalDays,
  isDateOnly,
  isDueToday,
  isNoDueDate,
  isOverdue,
  localDateOf,
  startOfLocalDay,
  toLocalDate,
  type LocalDate,
} from './due-dates'

/** A block is at most 12 hours. */
export const MAX_BLOCK_MINUTES = 720
/** Gestures work in 15-minute steps, and a dragged block is at least one step. */
export const BLOCK_STEP_MINUTES = 15
export const DEFAULT_LENGTH_MINUTES = 30
/** The lengths `planner.default_length` may hold (section 11.3). */
export const BLOCK_LENGTHS = [15, 30, 45, 60, 75, 90] as const
export const DEFAULT_PLANNER_HOURS: PlannerHours = ['08:00', '18:00']

export type PlannerHours = [string, string]

type DateValue = string | Date | null | undefined

function instant(value: DateValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (isNoDueDate(value)) return null
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function nextMidnight(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1)
}

/**
 * Both set, the end after the start, at most 12 hours apart, and the end no later than the
 * midnight that ends the start's local day.
 */
export function isTimeBlock(start: DateValue, end: DateValue): boolean {
  const from = instant(start)
  const to = instant(end)
  if (!from || !to) return false
  const minutes = (to.getTime() - from.getTime()) / 60_000
  if (minutes <= 0 || minutes > MAX_BLOCK_MINUTES) return false
  return to.getTime() <= nextMidnight(from).getTime()
}

export interface BlockFields {
  start_date?: string | null
  end_date?: string | null
}

export interface TimeBlock {
  start: Date
  end: Date
  /** The local date of the start. */
  day: LocalDate
  minutes: number
}

/** A task's block, or null when its two dates are not one. */
export function blockOf(task: BlockFields | null | undefined): TimeBlock | null {
  if (!task || !isTimeBlock(task.start_date, task.end_date)) return null
  const start = new Date(task.start_date as string)
  const end = new Date(task.end_date as string)
  return { start, end, day: toLocalDate(start), minutes: Math.round((end.getTime() - start.getTime()) / 60_000) }
}

export function blockStartsOn(task: BlockFields | null | undefined, day: LocalDate): boolean {
  return blockOf(task)?.day === day
}

/**
 * A date-only due date on the block's own day says nothing the block does not (section 16.4), so a
 * row leaves it out. An overdue one stays: it is a warning, not a day phrase.
 */
export function dueRepeatsBlockDay(due: string | null | undefined, block: Pick<TimeBlock, 'day'>, now: Date = new Date()): boolean {
  return !isNoDueDate(due) && isDateOnly(due as string) && localDateOf(due) === block.day && !isOverdue(due, now)
}

// --- The Today list (sections 2 and 16.4) ----------------------------------------------------------

/**
 * Overdue, then the Today section: due today, or a block starting today. A task due earlier with a
 * block today stays in Overdue. Upcoming, custom lists and the guided queues read the due date only.
 */
export function splitToday<T extends BlockFields & { due_date?: string | null }>(
  tasks: readonly T[],
  now: Date,
): { overdue: T[]; today: T[] } {
  const overdue: T[] = []
  const today: T[] = []
  const day = toLocalDate(now)
  for (const task of tasks) {
    if (isOverdue(task.due_date, now)) overdue.push(task)
    else if (isDueToday(task.due_date, now) || blockStartsOn(task, day)) today.push(task)
  }
  return { overdue, today }
}

// --- Writing a block (section 16.2) -----------------------------------------------------------------

/** A wall-clock time on a local date. Past a midnight it rolls to the next day, as `Date` does. */
export function atClock(day: LocalDate, minutes: number): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, minutes, 0, 0)
}

export function minutesOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes()
}

/** The due rule: no due date or one before the start becomes that day, date-only. A later one is a deadline. */
export function dueForBlock(due: string | null | undefined, start: Date): string {
  const current = instant(due)
  if (!current || current.getTime() < start.getTime()) return dateOnlyDue(toLocalDate(start))
  return due as string
}

/** The end of a block from its start and length: held at the midnight that ends its day. */
export function blockEnd(start: Date, minutes: number): Date {
  const end = new Date(start.getTime() + minutes * 60_000)
  const midnight = nextMidnight(start)
  return end.getTime() > midnight.getTime() ? midnight : end
}

export interface BlockChanges extends BlockFields {
  due_date?: string | null
  reminders?: BlockReminder[]
}

/** Drop a task on a time, or move a block: start, end and the due rule. */
export function placeBlock(due: string | null | undefined, start: Date, minutes: number): BlockChanges {
  return {
    start_date: start.toISOString(),
    end_date: blockEnd(start, minutes).toISOString(),
    due_date: dueForBlock(due, start),
  }
}

/** Drag the bottom edge to `end`: only the end changes, kept to at least one step and within 16.1. */
export function resizeBlockEnd(block: Pick<TimeBlock, 'start'>, end: Date): BlockChanges {
  const earliest = block.start.getTime() + BLOCK_STEP_MINUTES * 60_000
  const latest = Math.min(block.start.getTime() + MAX_BLOCK_MINUTES * 60_000, nextMidnight(block.start).getTime())
  return { end_date: new Date(Math.max(earliest, Math.min(latest, end.getTime()))).toISOString() }
}

/** Drag the top edge to `start`: the start and the due rule; the end stays. */
export function resizeBlockStart(
  due: string | null | undefined,
  block: Pick<TimeBlock, 'end'>,
  start: Date,
): BlockChanges {
  const end = block.end.getTime()
  const latest = end - BLOCK_STEP_MINUTES * 60_000
  const dayStart = startOfLocalDay(toLocalDate(new Date(end - 1))).getTime()
  const earliest = Math.max(dayStart, end - MAX_BLOCK_MINUTES * 60_000)
  const next = new Date(Math.max(earliest, Math.min(latest, start.getTime())))
  return { start_date: next.toISOString(), due_date: dueForBlock(due, next) }
}

export interface BlockReminder {
  reminder?: string
  relative_period?: number
  relative_to?: string
}

/** Reminders that are not relative to the block: the ones that outlive removing its time. */
export function remindersWithoutBlock<T extends BlockReminder>(reminders: readonly T[] | null | undefined): T[] {
  return (reminders ?? []).filter((r) => r.relative_to !== 'start_date' && r.relative_to !== 'end_date')
}

/** Remove the time: both dates null, and any reminder relative to either. The due date stays. */
export function removeTime(task: { reminders?: readonly BlockReminder[] | null }): BlockChanges {
  const changes: BlockChanges = { start_date: null, end_date: null }
  const kept = remindersWithoutBlock(task.reminders)
  if (kept.length !== (task.reminders?.length ?? 0)) changes.reminders = kept
  return changes
}

/** Drop a task on a day without a time. */
export function planForDay(task: { reminders?: readonly BlockReminder[] | null }, day: LocalDate): BlockChanges {
  return { ...removeTime(task), due_date: dateOnlyDue(day) }
}

// --- When the due date changes (section 16.3) --------------------------------------------------------

export interface DueChangeInput extends BlockFields {
  due_date?: string | null
  reminders?: readonly BlockReminder[] | null
}

/**
 * What else a change of the due date writes, or null. A block on the day of the old due date follows
 * it at the same wall-clock times, and goes when the new date is before today or cleared. A block on
 * any other day stays, and so does one when only the due date's time changes.
 */
export function blockChangesForDue(
  task: DueChangeInput,
  newDue: string | null | undefined,
  now: Date,
): BlockChanges | null {
  const block = blockOf(task)
  if (!block || isNoDueDate(task.due_date) || localDateOf(task.due_date) !== block.day) return null
  if (isNoDueDate(newDue)) return removeTime(task)
  const newDay = localDateOf(newDue)
  if (newDay < toLocalDate(now)) return removeTime(task)
  if (newDay === block.day) return null
  const days = diffLocalDays(block.day, newDay)
  const moved = (value: Date): string => {
    const d = new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, value.getHours(), value.getMinutes(), value.getSeconds())
    return d.toISOString()
  }
  return { start_date: moved(block.start), end_date: moved(block.end) }
}

/**
 * `changes` with the rule above applied, for anything that sets a due date in a patch. A change that
 * writes the block itself (the Plan screen, `for 30m` in the title editor) already decided, so it is
 * left as it is.
 */
export function withDueChangeRules<C extends BlockChanges>(task: DueChangeInput | null | undefined, changes: C, now: Date): C {
  if (!task || changes.due_date === undefined) return changes
  if (changes.start_date !== undefined || changes.end_date !== undefined) return changes
  const extra = blockChangesForDue(task, changes.due_date, now)
  return extra ? { ...changes, ...extra } : changes
}

// --- Free time and fitting (section 16.6) ------------------------------------------------------------

/** A busy stretch in minutes from the local midnight of the day. */
export type BusyRange = readonly [number, number]

export function clockMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

export function clockText(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** The stretch of a day the work hours leave: today from now on. Null when nothing is left. */
function workWindow(now: Date, day: LocalDate, hours: PlannerHours): { from: number; to: number } | null {
  const today = toLocalDate(now)
  if (day < today) return null
  const to = clockMinutes(hours[1])
  const from = day === today ? Math.max(clockMinutes(hours[0]), minutesOfDay(now)) : clockMinutes(hours[0])
  return from < to ? { from, to } : null
}

function mergedBusy(busy: readonly BusyRange[]): BusyRange[] {
  const sorted = [...busy].filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

/** The work hours (today, from now) minus busy time, with overlaps counted once. */
export function freeMinutes(now: Date, day: LocalDate, hours: PlannerHours, busy: readonly BusyRange[]): number {
  const window = workWindow(now, day, hours)
  if (!window) return 0
  let free = window.to - window.from
  for (const [a, b] of mergedBusy(busy)) {
    const from = Math.max(a, window.from)
    const to = Math.min(b, window.to)
    if (to > from) free -= to - from
  }
  return free
}

/** The free stretches of a day, in minutes from its midnight: the work hours less busy time. */
export function freeRanges(now: Date, day: LocalDate, hours: PlannerHours, busy: readonly BusyRange[]): [number, number][] {
  const window = workWindow(now, day, hours)
  if (!window) return []
  const ranges: [number, number][] = []
  let at = window.from
  for (const [a, b] of mergedBusy(busy)) {
    if (b <= at) continue
    if (a >= window.to) break
    if (a > at) ranges.push([at, a])
    at = Math.max(at, b)
  }
  if (at < window.to) ranges.push([at, window.to])
  return ranges
}

function nextLine(minutes: number): number {
  return Math.ceil(minutes / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
}

/**
 * The first 15-minute line from the start of the work hours (today, from now) where `minutes` fits
 * without touching busy time and ends inside the work hours. Null when there is none.
 */
export function nextFreeSlot(
  now: Date,
  day: LocalDate,
  hours: PlannerHours,
  minutes: number,
  busy: readonly BusyRange[],
): number | null {
  const window = workWindow(now, day, hours)
  if (!window) return null
  const ranges = mergedBusy(busy)
  let at = nextLine(window.from)
  for (;;) {
    if (at + minutes > window.to) return null
    const hit = ranges.find(([a, b]) => at < b && at + minutes > a)
    if (!hit) return at
    at = nextLine(hit[1])
  }
}

export interface FitTask {
  id: number
  due_date?: string | null
  priority?: number
}

/** Overdue first, then priority from high to low, then due date from earliest, no due date last, then id. */
export function fitOrder<T extends FitTask>(tasks: readonly T[], now: Date): T[] {
  const time = (task: T): number => instant(task.due_date)?.getTime() ?? Number.POSITIVE_INFINITY
  return [...tasks].sort((a, b) => {
    const overdue = Number(isOverdue(b.due_date, now)) - Number(isOverdue(a.due_date, now))
    if (overdue !== 0) return overdue
    const priority = (b.priority ?? 0) - (a.priority ?? 0)
    if (priority !== 0) return priority
    const due = time(a) === time(b) ? 0 : time(a) < time(b) ? -1 : 1
    return due !== 0 ? due : a.id - b.id
  })
}

export interface FittedTask<T> {
  task: T
  /** Minutes from the local midnight of the day. */
  start: number
  end: number
}

/** Each task in `fitOrder` takes the next free slot at `lengthOf(task)`. What does not fit is left out. */
export function fitTasks<T extends FitTask>(
  tasks: readonly T[],
  options: {
    now: Date
    day: LocalDate
    hours: PlannerHours
    busy: readonly BusyRange[]
    lengthOf: (task: T) => number
  },
): FittedTask<T>[] {
  const busy: BusyRange[] = [...options.busy]
  const fitted: FittedTask<T>[] = []
  for (const task of fitOrder(tasks, options.now)) {
    const length = options.lengthOf(task)
    const start = nextFreeSlot(options.now, options.day, options.hours, length, busy)
    if (start === null) continue
    fitted.push({ task, start, end: start + length })
    busy.push([start, start + length])
  }
  return fitted
}

/** The busy ranges a day's open blocks make. Routines and due-time markers have no length and are never busy. */
export function busyOfDay<T extends BlockFields & { done?: boolean }>(tasks: readonly T[], day: LocalDate): BusyRange[] {
  const ranges: BusyRange[] = []
  for (const task of tasks) {
    if (task.done) continue
    const block = blockOf(task)
    if (!block || block.day !== day) continue
    const start = minutesOfDay(block.start)
    ranges.push([start, start + diffMinutes(block)])
  }
  return ranges
}

function diffMinutes(block: TimeBlock): number {
  // Wall-clock length, so a block across a clock change still fits the day's grid.
  return block.end.getTime() === nextMidnight(block.start).getTime()
    ? 24 * 60 - minutesOfDay(block.start)
    : minutesOfDay(block.end) - minutesOfDay(block.start)
}

/** The days of a view: one, three from the selected day, or the Monday-start week holding it. */
export function viewDays(view: PlanViewKind, day: LocalDate, weekStart: (d: LocalDate) => LocalDate): LocalDate[] {
  if (view === 'day') return [day]
  const first = view === 'week' ? weekStart(day) : day
  const count = view === 'week' ? 7 : 3
  return Array.from({ length: count }, (_, i) => addLocalDays(first, i))
}

export type PlanViewKind = 'day' | '3days' | 'week'

// --- The two preferences (section 11.3) --------------------------------------------------------------

export function readDefaultLength(value: unknown): number {
  return typeof value === 'number' && (BLOCK_LENGTHS as readonly number[]).includes(value) ? value : DEFAULT_LENGTH_MINUTES
}

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function readPlannerHours(value: unknown): PlannerHours {
  if (!Array.isArray(value) || value.length !== 2) return [...DEFAULT_PLANNER_HOURS]
  const [start, end] = value as unknown[]
  if (typeof start !== 'string' || typeof end !== 'string') return [...DEFAULT_PLANNER_HOURS]
  if (!CLOCK_RE.test(start) || !CLOCK_RE.test(end) || start >= end) return [...DEFAULT_PLANNER_HOURS]
  return [start, end]
}
