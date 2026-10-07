/**
 * Due-date rules shared by the main process and the renderer. Implements sections 1, 2 and 4
 * of docs/cross-app-semantics-v1.md; Android implements the same contract (`DueDates`) and both
 * apps run test-fixtures/cross-app-semantics-v1.json against it.
 *
 * - A due date without a time ("date-only") is stored as local 23:59:59 of that date (ms 0).
 * - Legacy values at local 00:00:00 are read as date-only too; they are not rewritten in bulk.
 * - Any other local time is an explicit time and is kept as typed.
 * - "Today" is the device's local calendar date; weeks start on Monday.
 *
 * Calendar dates travel as local `YYYY-MM-DD` strings and all day arithmetic is done on them
 * (via UTC components), never on instants, so a DST change or a zone far from UTC cannot shift
 * a date. Only the helpers that return an instant (`dateOnlyDue`, the boundary helpers) touch
 * the process time zone, because "local" is the whole point of those.
 *
 * This file must stay free of imports so any tsconfig can include it.
 */

/** Vikunja's null date. Duplicated here on purpose to keep this file import-free. */
const NULL_DUE_DATE = '0001-01-01T00:00:00Z'

/** A local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string

const MS_PER_DAY = 86_400_000

const pad2 = (n: number): string => String(n).padStart(2, '0')

function formatLocalDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

function parseLocalDate(localDate: LocalDate): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate)
  if (!match) throw new Error(`Invalid local date: ${localDate}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/** Whole calendar days since 1970-01-01 for a local date (time zone free). */
function epochDay(localDate: LocalDate): number {
  const { year, month, day } = parseLocalDate(localDate)
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY)
}

function fromEpochDay(days: number): LocalDate {
  const d = new Date(days * MS_PER_DAY)
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

// --- Calendar dates ---------------------------------------------------------------------

/** The local calendar date of an instant (never the UTC date, which differs near midnight). */
export function toLocalDate(instant: Date): LocalDate {
  return formatLocalDate(instant.getFullYear(), instant.getMonth() + 1, instant.getDate())
}

/** Local midnight at the start of a calendar date, or of the day an instant falls on. */
export function startOfLocalDay(value: LocalDate | Date): Date {
  const { year, month, day } = parseLocalDate(typeof value === 'string' ? value : toLocalDate(value))
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

/** `localDate` plus `days` calendar days (negative goes back). */
export function addLocalDays(localDate: LocalDate, days: number): LocalDate {
  return fromEpochDay(epochDay(localDate) + days)
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function diffLocalDays(from: LocalDate, to: LocalDate): number {
  return epochDay(to) - epochDay(from)
}

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export function isoWeekday(localDate: LocalDate): number {
  const { year, month, day } = parseLocalDate(localDate)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
}

/** The Monday of the week containing `localDate` (weeks start on Monday). */
export function startOfWeek(localDate: LocalDate): LocalDate {
  return addLocalDays(localDate, 1 - isoWeekday(localDate))
}

/** The Sunday ending the week that contains `localDate` (on a Sunday: that day). */
export function endOfWeek(localDate: LocalDate): LocalDate {
  return addLocalDays(localDate, 7 - isoWeekday(localDate))
}

/** The Monday after `localDate`: strictly in the future, so a Monday gives the next week's. */
export function nextWeekStart(localDate: LocalDate): LocalDate {
  return addLocalDays(endOfWeek(localDate), 1)
}

/** The last day of the month `localDate` is in. */
export function endOfMonth(localDate: LocalDate): LocalDate {
  const { year, month } = parseLocalDate(localDate)
  return fromEpochDay(Math.round(Date.UTC(year, month, 1) / MS_PER_DAY) - 1)
}

// --- Due-date values --------------------------------------------------------------------

/** True for no due date at all: empty, the Vikunja null date, or something unparseable. */
export function isNoDueDate(value: string | null | undefined): boolean {
  if (!value || value === NULL_DUE_DATE) return true
  return Number.isNaN(new Date(value).getTime())
}

/**
 * The due date for "this date, no time": local 23:59:59.000 of `localDate`, as a UTC ISO string.
 * Every date-only setter goes through this one function.
 */
export function dateOnlyDue(localDate: LocalDate): string {
  const { year, month, day } = parseLocalDate(localDate)
  return new Date(year, month - 1, day, 23, 59, 59, 0).toISOString()
}

/** The local calendar date of a stored due date, or '' when there is none. */
export function localDateOf(value: string | Date | null | undefined): LocalDate {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    if (isNoDueDate(value)) return ''
    return toLocalDate(new Date(value))
  }
  return Number.isNaN(value.getTime()) ? '' : toLocalDate(value)
}

/**
 * Whether a due date carries no time of day: local 23:59:59 (this contract) or local 00:00:00
 * (older versions stored date-only values at midnight). Milliseconds are ignored.
 */
export function isDateOnly(value: string): boolean {
  if (isNoDueDate(value)) return false
  const d = new Date(value)
  const h = d.getHours()
  const m = d.getMinutes()
  const s = d.getSeconds()
  return (h === 23 && m === 59 && s === 59) || (h === 0 && m === 0 && s === 0)
}

// --- Setters ----------------------------------------------------------------------------

/** "Today", "!" and Ctrl+T: today's local date, date-only. */
export function dueToday(now: Date = new Date()): string {
  return dateOnlyDue(toLocalDate(now))
}

/** "Tomorrow": tomorrow's local date, date-only. */
export function dueTomorrow(now: Date = new Date()): string {
  return dateOnlyDue(addLocalDays(toLocalDate(now), 1))
}

/** "Next week": the Monday of next week (on a Sunday: the next day), date-only. */
export function dueNextWeek(now: Date = new Date()): string {
  return dateOnlyDue(nextWeekStart(toLocalDate(now)))
}

/**
 * Postpone / move by `days` calendar days. An explicit time of day is kept; a date-only value
 * (including a legacy 00:00 one) stays date-only and becomes 23:59:59. Without a due date the
 * count starts from today.
 */
export function postponeDays(value: string | null | undefined, days: number, now: Date = new Date()): string {
  if (isNoDueDate(value) || isDateOnly(value as string)) {
    const base = isNoDueDate(value) ? toLocalDate(now) : localDateOf(value)
    return dateOnlyDue(addLocalDays(base, days))
  }
  const due = new Date(value as string)
  const { year, month, day } = parseLocalDate(addLocalDays(toLocalDate(due), days))
  return new Date(year, month - 1, day, due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds()).toISOString()
}

/**
 * The due date for a date parsed from free text. When the text named a time of day
 * (`hasTime`, chrono's `start.isCertain('hour')`) that time is kept to the minute; otherwise the
 * date is date-only. Never mutates `parsed`.
 */
export function parsedDue(parsed: Date, hasTime: boolean): string {
  if (!hasTime) return dateOnlyDue(toLocalDate(parsed))
  const exact = new Date(parsed.getTime())
  exact.setSeconds(0, 0)
  return exact.toISOString()
}

// --- Today / Upcoming classification ----------------------------------------------------

export type DueBucket = 'none' | 'overdue' | 'today' | 'upcoming'

/** Where a due date sits relative to the local date of `now`, whatever its time of day. */
export function dueBucket(value: string | null | undefined, now: Date = new Date()): DueBucket {
  const due = localDateOf(value)
  if (!due) return 'none'
  const today = toLocalDate(now)
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'upcoming'
}

/** Local date before today. A task due at 08:00 today is not overdue at 10:00; tomorrow it is. */
export function isOverdue(value: string | null | undefined, now: Date = new Date()): boolean {
  return dueBucket(value, now) === 'overdue'
}

/** Local date equal to today, whatever the time of day. */
export function isDueToday(value: string | null | undefined, now: Date = new Date()): boolean {
  return dueBucket(value, now) === 'today'
}

/** Local date tomorrow or later. */
export function isUpcoming(value: string | null | undefined, now: Date = new Date()): boolean {
  return dueBucket(value, now) === 'upcoming'
}

// --- Server filter boundaries -----------------------------------------------------------

/**
 * Local midnight at the start of the day `offsetDays` after the local date of `now`, as a UTC
 * ISO string for a server filter. 0 is today, 1 is tomorrow ("before the start of tomorrow" is
 * `due_date < startOfLocalDayIso(1)`). A server filter may return more than the window, never
 * less; the client applies the exact rule.
 */
export function startOfLocalDayIso(offsetDays = 0, now: Date = new Date()): string {
  return startOfLocalDay(addLocalDays(toLocalDate(now), offsetDays)).toISOString()
}

/** The due-date windows of the Today and Upcoming lists. */
export type DueWindow = 'today' | 'upcoming'

/**
 * The server filter clause for a list window, from the start of local tomorrow: Today is
 * everything due before it (overdue and due today), Upcoming everything from then on. That is
 * exactly the client rule (`isOverdue || isDueToday`, `isUpcoming`), so the lists fetch what they
 * show and no more. Callers combine it with `done = false` and a due date that exists.
 */
export function dueWindowClause(window: DueWindow, now: Date = new Date()): string {
  const tomorrowStart = startOfLocalDayIso(1, now)
  return window === 'today' ? `due_date < '${tomorrowStart}'` : `due_date >= '${tomorrowStart}'`
}

/**
 * `filter` plus the clause of `window`. A window this version does not know adds nothing (the
 * value comes through IPC, so it is checked). The boundary is read when the request is made, so a
 * query that outlives midnight moves with the day.
 */
export function withDueWindow(filter: string | undefined, window: unknown, now: Date = new Date()): string | undefined {
  if (window !== 'today' && window !== 'upcoming') return filter
  const clause = dueWindowClause(window, now)
  return filter ? `${filter} && ${clause}` : clause
}
