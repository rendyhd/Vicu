import { NULL_DATE } from './constants'
import {
  formatAbsoluteDateTime as formatAbsolute,
  formatDateDisplay,
  type DateFormat,
} from './date-display'
import { getDateFormat } from './date-format'
import {
  addLocalDays,
  isDateOnly,
  localDateOf,
  nextWeekStart,
  toLocalDate,
} from './due-dates'

// The rules themselves (date-only due time, Today/Upcoming classification, week helpers) live
// in ./due-dates and are shared with the main process. This file only holds what the UI needs
// on top of them: null checks, date labels (phrased by ./date-display) and the date picker's quick picks.

export function isNullDate(date: string): boolean {
  return !date || date === NULL_DATE
}

/**
 * What a due date reads as in a task row (contract section 8): "Today", "Fri", "27 Sep", plus the
 * time of day, in the locale and clock of the window. `context` is `row` by default; Today passes
 * `row.inToday` and the day groups of Upcoming `row.inDayGroup`. Empty when there is nothing to show.
 */
export function formatDueDate(
  date: string,
  now: Date = new Date(),
  fmt: DateFormat = getDateFormat(),
  context: 'row' | 'row.inToday' | 'row.inDayGroup' = 'row'
): string {
  if (isNullDate(date)) return ''
  return formatDateDisplay(context, new Date(date), now, isDateOnly(date), fmt)
}

/** The `chip` phrasing: always the weekday date ("Sat 10 Oct, 15:00"), never a relative word. */
export function formatDateChip(
  date: Date,
  dateOnly: boolean,
  now: Date = new Date(),
  fmt: DateFormat = getDateFormat()
): string {
  return formatDateDisplay('chip', date, now, dateOnly, fmt)
}

/** Time of day in the window's clock ("15:00" or "3:00 PM"). */
export function formatClockTime(d: Date, fmt: DateFormat = getDateFormat()): string {
  return formatDateDisplay('logbook.time', d, d, false, fmt)
}

/** A time given as minutes after midnight (routine slots) in the window's clock. */
export function formatMinutesOfDay(minutes: number, fmt: DateFormat = getDateFormat()): string {
  return formatClockTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60), fmt)
}

/** A timestamp for details (created, updated, completed): the date with its year, then the time. */
export function formatAbsoluteDateTime(date: string, fmt: DateFormat = getDateFormat()): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return formatAbsolute(d, fmt)
}

/** Value for a date input: the local calendar day of a stored instant, or '' when unset. */
export function localDateInputValue(date: string): string {
  return localDateOf(date)
}

/** The quick-pick dates of the date picker as local YYYY-MM-DD strings. */
export function datePickerPresets(now: Date = new Date()): {
  today: string
  tomorrow: string
  nextWeek: string
} {
  const today = toLocalDate(now)
  return {
    today,
    tomorrow: addLocalDays(today, 1),
    // The Monday after today; on a Sunday that is the next day.
    nextWeek: nextWeekStart(today),
  }
}
