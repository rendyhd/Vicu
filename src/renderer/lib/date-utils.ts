import * as chrono from 'chrono-node'
import { NULL_DATE } from './constants'
import {
  addLocalDays,
  diffLocalDays,
  isDateOnly,
  localDateOf,
  nextWeekStart,
  toLocalDate,
} from './due-dates'

// The rules themselves (date-only due time, Today/Upcoming classification, week helpers) live
// in ./due-dates and are shared with the main process. This file only holds what the UI needs
// on top of them: null checks, labels and the date picker's quick picks.

export function isNullDate(date: string): boolean {
  return !date || date === NULL_DATE
}

/**
 * Relative label for the local date of a due date: Today, Tomorrow, Yesterday, a weekday within
 * the coming week, or "Oct 6" (with the year when it is not the current year).
 */
export function formatRelativeDate(date: string, now: Date = new Date()): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  const diffDays = diffLocalDays(toLocalDate(now), toLocalDate(d))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'

  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }

  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Time of day in the viewer's 12/24-hour convention (locale defaults to the system's). */
export function formatClockTime(d: Date, locale?: string): string {
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Label for a due date: the relative date, plus the time of day when the value has an explicit
 * time. Date-only values (local 23:59:59, or legacy 00:00) show no time.
 */
export function formatDueDate(date: string, now: Date = new Date(), locale?: string): string {
  const base = formatRelativeDate(date, now)
  if (!base || isDateOnly(date)) return base
  return `${base} ${formatClockTime(new Date(date), locale)}`
}

export function parseNaturalDate(text: string): Date | null {
  const results = chrono.parse(text)
  if (results.length === 0) return null
  return results[0].start.date()
}

export function formatAbsoluteDateTime(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  return `${datePart} at ${timePart}`
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
