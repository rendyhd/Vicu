import {
  addLocalDays,
  dateOnlyDue,
  diffLocalDays,
  endOfMonth,
  endOfWeek,
  isDateOnly,
  isNoDueDate,
  nextWeekStart,
  startOfLocalDay,
  startOfWeek,
  toLocalDate,
  type LocalDate,
} from './due-dates'
import {
  formatDateDisplay,
  formatWeekdayDay,
  formatWeekdayShort,
  type DateFormat,
} from './date-display'
import { formatMinutesOfDay } from './date-utils'
import { extractDate } from './task-parser/extract-dates'

// The pure rules of the When panel (card 3.4a1): what a picked day and time mean as a due date,
// the month grid and its keyboard moves, the quick choices, and how typed text becomes a
// selection (through the quick-add parser's own date extraction, so the panel and the composer
// read "tomorrow 9am" the same way). No React and no DOM.

/** A picked day and, optionally, a time of day ("HH:mm", 24-hour). No time means date-only. */
export interface WhenValue {
  date: LocalDate | null
  time: string | null
}

export const EMPTY_WHEN: WhenValue = { date: null, time: null }

/** The times offered under the grid. */
export const TIME_CHOICES = ['09:00', '12:00', '15:00', '18:00'] as const

/** The time a reminder gets when only a day was picked. */
export const DEFAULT_REMINDER_TIME = '09:00'

// --- Time of day ----------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "HH:mm" to minutes after midnight, or null when it is not a time. */
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  return h < 24 && m < 60 ? h * 60 + m : null
}

/** The clock text of "HH:mm" in the window's clock ("3:00 PM" or "15:00"). */
export function timeLabel(time: string, fmt: DateFormat): string {
  return formatMinutesOfDay(timeToMinutes(time) ?? 0, fmt)
}

/**
 * A time typed by hand: "15:30", "3pm", "3:30 pm", "7" (an hour on its own is read on the 24-hour
 * clock, "7pm" is 19:00). Returns "HH:mm" or null.
 */
export function parseTimeText(text: string): string | null {
  const match = /^\s*(\d{1,2})(?:[:.h](\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(text)
  if (!match) return null
  let hour = Number(match[1])
  const minute = match[2] === undefined ? 0 : Number(match[2])
  const meridiem = match[3]?.toLowerCase()
  if (minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (meridiem === 'p' ? 12 : 0)
  } else if (hour > 23) {
    return null
  }
  return `${pad2(hour)}:${pad2(minute)}`
}

/**
 * Whether a blur is focus moving to another control of the same panel. The custom time field
 * applies what was typed only then (or on Enter): Escape and a press outside also blur the field,
 * and they must discard the unconfirmed time instead of applying it.
 */
export function focusStaysInside(container: { contains(node: unknown): boolean } | null, next: unknown): boolean {
  return container !== null && next !== null && next !== undefined && container.contains(next)
}

// --- Value and due date ---------------------------------------------------------------------

/** What a stored due date reads as in the panel. No date, the null date or garbage: nothing picked. */
export function whenValueOfDue(due: string | null | undefined): WhenValue {
  if (!due || isNoDueDate(due)) return EMPTY_WHEN
  const at = new Date(due)
  const date = toLocalDate(at)
  if (isDateOnly(due)) return { date, time: null }
  return { date, time: `${pad2(at.getHours())}:${pad2(at.getMinutes())}` }
}

/** The local instant of a day and a time of day. */
export function instantOf(date: LocalDate, time: string): Date {
  const start = startOfLocalDay(date)
  const minutes = timeToMinutes(time) ?? 0
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0)
}

/**
 * The due date a value stands for: a day without a time is local 23:59:59 (`dateOnlyDue`, the one
 * place date-only values are made), a day with a time is that minute. Null when no day is picked
 * (clear the due date).
 */
export function dueOfWhenValue(value: WhenValue): string | null {
  if (!value.date) return null
  return value.time ? instantOf(value.date, value.time).toISOString() : dateOnlyDue(value.date)
}

/** The same value with a day (and the time kept). */
export function withDate(value: WhenValue, date: LocalDate): WhenValue {
  return { date, time: value.time }
}

/** The same value with a time; a time without a day picked starts from `today`. */
export function withTime(value: WhenValue, time: string | null, today: LocalDate): WhenValue {
  if (time === null) return { date: value.date, time: null }
  return { date: value.date ?? today, time }
}

export function sameValue(a: WhenValue, b: WhenValue): boolean {
  return a.date === b.date && a.time === b.time
}

// --- Month grid -------------------------------------------------------------------------------

/** The first day of the month `date` is in. */
export function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`
}

/** `months` months later (negative: earlier), the day of the month kept or clamped to the month's end. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7)) - 1
  const day = Number(date.slice(8, 10))
  const total = year * 12 + month + months
  const first = `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad2((total % 12) + 1)}-01`
  const last = Number(endOfMonth(first).slice(8, 10))
  return `${first.slice(0, 8)}${pad2(Math.min(day, last))}`
}

export interface GridDay {
  date: LocalDate
  /** True for a day of the shown month, false for the dimmed days of the weeks around it. */
  inMonth: boolean
}

/** Six weeks starting on Monday that cover the month of `month`; always six rows so the grid keeps its height. */
export function monthGrid(month: LocalDate): GridDay[][] {
  const first = monthStart(month)
  const start = startOfWeek(first)
  const prefix = first.slice(0, 7)
  const rows: GridDay[][] = []
  for (let r = 0; r < 6; r++) {
    const row: GridDay[] = []
    for (let c = 0; c < 7; c++) {
      const date = addLocalDays(start, r * 7 + c)
      row.push({ date, inMonth: date.startsWith(prefix) })
    }
    rows.push(row)
  }
  return rows
}

/**
 * Where a key moves the focused day: arrows by a day or a week, PageUp and PageDown by a month
 * (a year with Shift), Home and End to the start and end of the week. Null for any other key.
 */
export function moveGridFocus(current: LocalDate, key: string, shift = false): LocalDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addLocalDays(current, -1)
    case 'ArrowRight':
      return addLocalDays(current, 1)
    case 'ArrowUp':
      return addLocalDays(current, -7)
    case 'ArrowDown':
      return addLocalDays(current, 7)
    case 'PageUp':
      return addMonths(current, shift ? -12 : -1)
    case 'PageDown':
      return addMonths(current, shift ? 12 : 1)
    case 'Home':
      return startOfWeek(current)
    case 'End':
      return endOfWeek(current)
    default:
      return null
  }
}

// --- Quick choices --------------------------------------------------------------------------

export interface QuickChoice {
  id: 'today' | 'tomorrow' | 'weekend' | 'nextWeek'
  label: string
  /** The weekday (and day of the month for next week) the choice lands on: "Wed", "Mon 12". */
  hint: string
  date: LocalDate
}

/** The Saturday after `today` (a Saturday gives the next one). */
export function comingSaturday(today: LocalDate): LocalDate {
  const ahead = (5 - diffWeekdayFromMonday(today) + 7) % 7
  return addLocalDays(today, ahead === 0 ? 7 : ahead)
}

function diffWeekdayFromMonday(date: LocalDate): number {
  // 0 = Monday ... 6 = Sunday
  return diffLocalDays(startOfWeek(date), date)
}

/** Today, Tomorrow, This weekend (the coming Saturday) and Next week (the coming Monday), from `today`. */
export function quickChoices(today: LocalDate, fmt: DateFormat): QuickChoice[] {
  const tomorrow = addLocalDays(today, 1)
  const weekend = comingSaturday(today)
  const nextWeek = nextWeekStart(today)
  const day = (date: LocalDate) => startOfLocalDay(date)
  return [
    { id: 'today', label: 'Today', hint: formatWeekdayShort(day(today), fmt), date: today },
    { id: 'tomorrow', label: 'Tomorrow', hint: formatWeekdayShort(day(tomorrow), fmt), date: tomorrow },
    { id: 'weekend', label: 'This weekend', hint: formatWeekdayShort(day(weekend), fmt), date: weekend },
    { id: 'nextWeek', label: 'Next week', hint: formatWeekdayDay(day(nextWeek), fmt), date: nextWeek },
  ]
}

// --- Text -------------------------------------------------------------------------------------

export interface WhenParse {
  value: WhenValue
  /** The part of the text that was read as a date or time. */
  matched: string
}

/**
 * What the quick-add parser's date extraction makes of typed text ("tomorrow 9am", "next mon",
 * "oct 20 at 3pm"). A phrase that names no time gives a date-only value. Null when the text has no
 * date in it.
 */
export function parseWhenText(text: string, now: Date, locale?: string): WhenParse | null {
  if (!text.trim()) return null
  const found = extractDate(text, [], { reference: now, locale })
  if (!found.dueDate) return null
  const date = toLocalDate(found.dueDate)
  const time = found.hasTime ? `${pad2(found.dueDate.getHours())}:${pad2(found.dueDate.getMinutes())}` : null
  const token = found.tokens[0]
  return { value: { date, time }, matched: token ? token.raw : text.trim() }
}

/** A value as short text: "Sat 10 Oct, 15:00" (the chip phrasing). Empty when no day is picked. */
export function whenText(value: WhenValue, now: Date, fmt: DateFormat): string {
  if (!value.date) return ''
  const at = value.time ? instantOf(value.date, value.time) : startOfLocalDay(value.date)
  return formatDateDisplay('chip', at, now, value.time === null, fmt)
}
