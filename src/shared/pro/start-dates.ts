/**
 * Start dates (docs/cross-app-semantics-v1.md section 21.3): a task's `start_date` when it is not
 * part of a time block (section 16.1). A block replaces a start date: the block's start is written to
 * the same field. Both apps run the `pro.startVsBlock` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { isNoDueDate, toLocalDate, type LocalDate } from '../due-dates'
import { isTimeBlock } from '../time-blocks'

export interface StartFields {
  start_date?: string | null
  end_date?: string | null
}

function instant(value: string | null | undefined): Date | null {
  if (isNoDueDate(value)) return null
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** The task's start date, or null when it has none or its dates are a time block. */
export function startDateOf(task: StartFields | null | undefined): Date | null {
  if (!task) return null
  if (isTimeBlock(task.start_date, task.end_date)) return null
  return instant(task.start_date)
}

/** The local day the task starts on, or null. */
export function startDayOf(task: StartFields | null | undefined): LocalDate | null {
  const start = startDateOf(task)
  return start ? toLocalDate(start) : null
}

/** True while the task has a start date later than `now` (it is not available yet). */
export function startsLater(task: StartFields | null | undefined, now: Date): boolean {
  const start = startDateOf(task)
  return start !== null && start.getTime() > now.getTime()
}

/**
 * The stored value of "starts <day>" without a time: the local midnight that begins the day, so the
 * task is available all of that day.
 */
export function dateOnlyStart(day: LocalDate): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
}

/**
 * Decision 17: placing a block on a task whose start date is later than the block's start replaces
 * that start date. The UI warns first; true when it should.
 */
export function blockReplacesLaterStart(task: StartFields | null | undefined, blockStart: Date): boolean {
  const start = startDateOf(task)
  return start !== null && start.getTime() > blockStart.getTime()
}

export interface StartsEntry {
  id: number
  day: LocalDate
}

/**
 * Upcoming's "starts" entries (Pro on): open tasks whose start date is on a later local day than
 * `now`, by day, then id.
 */
export function startsEntries(
  tasks: ReadonlyArray<StartFields & { id: number; done?: boolean }>,
  now: Date,
): StartsEntry[] {
  const today = toLocalDate(now)
  const entries: StartsEntry[] = []
  for (const task of tasks) {
    if (task.done) continue
    const day = startDayOf(task)
    if (day !== null && day > today) entries.push({ id: task.id, day })
  }
  return entries.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id))
}
