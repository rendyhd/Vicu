import {
  addLocalDays,
  dateOnlyDue,
  isDateOnly,
  isoWeekday,
  nextWeekDay,
  toLocalDate,
  type LocalDate,
} from './due-dates'
import type { WeekStart } from './week-start'

// The When choices (docs/cross-app-semantics-v1.md, section 22): reading and writing the three
// synced settings, the day choices offered now, and Move by. The mobile app has the same in
// `util/WhenChoices.kt`. Pure: the clock and the zone come from the caller (the zone is the
// process zone, as everywhere in the desktop's date rules).

/** A named time of day (22.1): "Morning" at "09:00" (24-hour "HH:mm"). */
export interface TimeOfDay {
  name: string
  time: string
}

export type DayChoiceId =
  | 'today'
  | 'this_evening'
  | 'tomorrow'
  | 'tomorrow_morning'
  | 'this_weekend'
  | 'next_week'
  | 'in_2_days'
  | 'in_3_days'
  | 'next_month'

export type MoveStepId = '1d' | '2d' | '3d' | '1w' | '2w' | '1m'

export const WHEN_TIMES_KEY = 'when.times'
export const WHEN_DAYS_KEY = 'when.days'
export const WHEN_MOVE_BY_KEY = 'when.move_by'

export const MAX_TIMES = 5
export const MAX_DAYS = 6
export const MAX_MOVE_BY = 4
export const MAX_NAME_LENGTH = 20

/** Every day choice in the catalogue's order, with its label. */
export const DAY_CHOICES: readonly { id: DayChoiceId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'this_evening', label: 'This evening' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'tomorrow_morning', label: 'Tomorrow morning' },
  { id: 'this_weekend', label: 'This weekend' },
  { id: 'next_week', label: 'Next week' },
  { id: 'in_2_days', label: 'In 2 days' },
  { id: 'in_3_days', label: 'In 3 days' },
  { id: 'next_month', label: 'Next month' },
]

/** Every Move by step in the catalogue's order: so many calendar days, or a month. */
export const MOVE_STEPS: readonly { id: MoveStepId; label: string; days: number; months: number }[] = [
  { id: '1d', label: '+1 day', days: 1, months: 0 },
  { id: '2d', label: '+2 days', days: 2, months: 0 },
  { id: '3d', label: '+3 days', days: 3, months: 0 },
  { id: '1w', label: '+1 week', days: 7, months: 0 },
  { id: '2w', label: '+2 weeks', days: 14, months: 0 },
  { id: '1m', label: '+1 month', days: 0, months: 1 },
]

export const DEFAULT_TIMES: readonly TimeOfDay[] = [
  { name: 'Morning', time: '09:00' },
  { name: 'Noon', time: '12:00' },
  { name: 'Afternoon', time: '15:00' },
  { name: 'Evening', time: '18:00' },
]
export const DEFAULT_DAYS: readonly DayChoiceId[] = ['today', 'this_evening', 'tomorrow', 'this_weekend', 'next_week']
export const DEFAULT_MOVE_BY: readonly MoveStepId[] = ['1d', '2d', '1w', '1m']

export interface WhenChoiceSet {
  times: readonly TimeOfDay[]
  days: readonly DayChoiceId[]
  moveBy: readonly MoveStepId[]
}

export const DEFAULT_WHEN_CHOICES: WhenChoiceSet = { times: DEFAULT_TIMES, days: DEFAULT_DAYS, moveBy: DEFAULT_MOVE_BY }

/** A day choice as offered now: its day, and its time when it sets one (null keeps the picked time). */
export interface DayChoice {
  id: DayChoiceId
  label: string
  date: LocalDate
  time: string | null
}

export function dayChoiceLabel(id: DayChoiceId): string {
  return DAY_CHOICES.find((c) => c.id === id)?.label ?? id
}

export function moveStep(id: MoveStepId) {
  return MOVE_STEPS.find((s) => s.id === id)!
}

// --- Times of day (22.1) ---------------------------------------------------------------------

const NAME_RE = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u
const TIME_RE = /^(\d{2}):(\d{2})$/

/** Whether `name` may be a time of day's name: letters, digits and single spaces, 1 to 20 long. */
export function isValidTimeName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH && NAME_RE.test(name)
}

/** "HH:mm", 24-hour, two digits each; null for anything else. */
export function parseClockTime(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const match = TIME_RE.exec(text)
  if (!match) return null
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? text : null
}

/** Whether `times` keeps the rules of 22.1 (any order). */
export function isValidTimes(times: readonly TimeOfDay[]): boolean {
  return (
    times.length >= 1 &&
    times.length <= MAX_TIMES &&
    times.every((t) => isValidTimeName(t.name) && parseClockTime(t.time) !== null) &&
    new Set(times.map((t) => t.name.toLowerCase())).size === times.length &&
    new Set(times.map((t) => t.time)).size === times.length
  )
}

const byTime = (a: TimeOfDay, b: TimeOfDay) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0)

/** The stored `when.times`, in time order; any value that breaks the rules is the default. */
export function readTimes(value: unknown): TimeOfDay[] {
  if (!Array.isArray(value)) return [...DEFAULT_TIMES]
  const times: TimeOfDay[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [...DEFAULT_TIMES]
    const { name, time } = entry as Record<string, unknown>
    if (typeof name !== 'string' || parseClockTime(time) === null) return [...DEFAULT_TIMES]
    times.push({ name, time: time as string })
  }
  return isValidTimes(times) ? times.sort(byTime) : [...DEFAULT_TIMES]
}

function sameTimes(a: readonly TimeOfDay[], b: readonly TimeOfDay[]): boolean {
  return a.length === b.length && a.every((t, i) => t.name === b[i].name && t.time === b[i].time)
}

/** What to write for `times`: null for the default, else the entries in time order. */
export function writeTimes(times: readonly TimeOfDay[]): TimeOfDay[] | null {
  const sorted = [...times].sort(byTime).map((t) => ({ name: t.name, time: t.time }))
  return sameTimes(sorted, DEFAULT_TIMES) ? null : sorted
}

/** The earliest time before 12:00, or null. */
export function morningTime(times: readonly TimeOfDay[]): string | null {
  const before = times.map((t) => t.time).filter((t) => t < '12:00').sort()
  return before[0] ?? null
}

/** The latest time at 17:00 or later, or null. */
export function eveningTime(times: readonly TimeOfDay[]): string | null {
  const after = times.map((t) => t.time).filter((t) => t >= '17:00').sort()
  return after[after.length - 1] ?? null
}

// --- Day choices and Move by (22.2, 22.3) ------------------------------------------------------

function readIds<T extends string>(value: unknown, max: number, fallback: readonly T[], known: readonly T[]): T[] {
  if (!Array.isArray(value)) return [...fallback]
  if (!value.every((v) => typeof v === 'string')) return [...fallback]
  const keys = value as string[]
  if (keys.length > max || new Set(keys).size !== keys.length) return [...fallback]
  return keys.filter((k): k is T => (known as readonly string[]).includes(k))
}

export function readDays(value: unknown): DayChoiceId[] {
  return readIds(value, MAX_DAYS, DEFAULT_DAYS, DAY_CHOICES.map((c) => c.id))
}

export function readMoveBy(value: unknown): MoveStepId[] {
  return readIds(value, MAX_MOVE_BY, DEFAULT_MOVE_BY, MOVE_STEPS.map((s) => s.id))
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/** What to write for `days`: null for the default. Unknown ids are not carried along. */
export function writeDays(days: readonly DayChoiceId[]): DayChoiceId[] | null {
  return sameIds(days, DEFAULT_DAYS) ? null : [...days]
}

export function writeMoveBy(steps: readonly MoveStepId[]): MoveStepId[] | null {
  return sameIds(steps, DEFAULT_MOVE_BY) ? null : [...steps]
}

/** The three settings as read from the synced preferences' values. */
export function readWhenChoices(values: Readonly<Record<string, unknown>>): WhenChoiceSet {
  return {
    times: readTimes(values[WHEN_TIMES_KEY]),
    days: readDays(values[WHEN_DAYS_KEY]),
    moveBy: readMoveBy(values[WHEN_MOVE_BY_KEY]),
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const clockMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** The Saturday after `today` (a Saturday gives the next one). */
export function comingSaturday(today: LocalDate): LocalDate {
  const ahead = (6 - isoWeekday(today) + 7) % 7
  return addLocalDays(today, ahead === 0 ? 7 : ahead)
}

/** `months` months after `date`, the day of the month clamped to the month's end. */
export function addLocalMonths(date: LocalDate, months: number): LocalDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7)) - 1
  const day = Number(date.slice(8, 10))
  const total = year * 12 + month + months
  const y = Math.floor(total / 12)
  const m = total - y * 12
  const last = new Date(y, m + 1, 0).getDate()
  return `${String(y).padStart(4, '0')}-${pad2(m + 1)}-${pad2(Math.min(day, last))}`
}

/**
 * The day choices of `ids` offered at `now` (local time), in order: This evening only while there
 * is an evening time still ahead, Tomorrow morning only while there is a morning time.
 */
export function dayChoices(
  ids: readonly DayChoiceId[],
  now: Date,
  times: readonly TimeOfDay[] = DEFAULT_TIMES,
  weekStart: WeekStart = 'monday',
): DayChoice[] {
  const today = toLocalDate(now)
  const nowMs = ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 + now.getMilliseconds()
  const morning = morningTime(times)
  const evening = eveningTime(times)
  const out: DayChoice[] = []
  const add = (id: DayChoiceId, date: LocalDate, time: string | null = null) =>
    out.push({ id, label: dayChoiceLabel(id), date, time })
  for (const id of ids) {
    switch (id) {
      case 'today':
        add(id, today)
        break
      case 'this_evening':
        // While the evening time is still ahead of now.
        if (evening !== null && nowMs < clockMinutes(evening) * 60_000) add(id, today, evening)
        break
      case 'tomorrow':
        add(id, addLocalDays(today, 1))
        break
      case 'tomorrow_morning':
        if (morning !== null) add(id, addLocalDays(today, 1), morning)
        break
      case 'this_weekend':
        add(id, comingSaturday(today))
        break
      case 'next_week':
        add(id, nextWeekDay(today, weekStart))
        break
      case 'in_2_days':
        add(id, addLocalDays(today, 2))
        break
      case 'in_3_days':
        add(id, addLocalDays(today, 3))
        break
      case 'next_month':
        add(id, addLocalMonths(today, 1))
        break
    }
  }
  return out
}

/** The day `step` lands on for a due date on `dueDay`: an overdue task moves from `today`. */
export function moveDay(dueDay: LocalDate, step: MoveStepId, today: LocalDate): LocalDate {
  const { days, months } = moveStep(step)
  const from = dueDay < today ? today : dueDay
  return addLocalMonths(addLocalDays(from, days), months)
}

/**
 * `due` moved by `step` (22.3): from its local day, or `today` when that is earlier; a date-only
 * due date stays date-only and a timed one keeps its local clock time.
 */
export function moveBy(due: string, step: MoveStepId, today: LocalDate): string {
  const at = new Date(due)
  const day = moveDay(toLocalDate(at), step, today)
  if (isDateOnly(due)) return dateOnlyDue(day)
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, at.getHours(), at.getMinutes(), at.getSeconds(), 0).toISOString()
}

// --- The parser (5.6) ------------------------------------------------------------------------

// The times of day this process uses now, for the quick-add parser, which reads text without a
// hook to hand them over. The windows keep it in step with the synced setting (`useWhenChoices`,
// the quick-entry window's config); until then it is the default.
let currentTimes: readonly TimeOfDay[] = DEFAULT_TIMES

export function getTimesOfDay(): readonly TimeOfDay[] {
  return currentTimes
}

export function setTimesOfDay(times: readonly TimeOfDay[]): void {
  currentTimes = times
}

/** Words of section 5.1 that are never read as a time of day's name. */
const DATE_WORDS = new Set([
  'today', 'tomorrow', 'tonight', 'now', 'next', 'this', 'last', 'in', 'at', 'on', 'by', 'due',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'thurs', 'fri', 'sat', 'sun',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])

/** Whether the parser reads `name` as a time of day: a valid name that is no date word. */
export function isReadableTimeName(name: string): boolean {
  return isValidTimeName(name) && !DATE_WORDS.has(name.toLowerCase())
}
