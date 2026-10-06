import * as chrono from 'chrono-node'
import { NULL_DATE } from './constants'

export function isNullDate(date: string): boolean {
  return !date || date === NULL_DATE
}

export function isOverdue(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

export function isToday(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

export function isDueThisWeek(date: string): boolean {
  if (isNullDate(date)) return false
  const d = new Date(date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()))
  endOfWeek.setHours(23, 59, 59, 999)
  return d >= today && d <= endOfWeek
}

export function formatRelativeDate(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )

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

export function tomorrowAtMidnightISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function nextMondayAtMidnightISO(now: Date = new Date()): string {
  const d = new Date(now)
  // Sun(0)→+1, Mon(1)→+7, Wed(3)→+5; always the strictly-future Monday
  const offset = (1 - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** YYYY-MM-DD of the local calendar day (never the UTC day, which differs near midnight). */
export function toLocalDateString(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Value for a date input: the local calendar day of a stored instant, or '' when unset. */
export function localDateInputValue(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? '' : toLocalDateString(d)
}

/** Local-midnight instant for a picked YYYY-MM-DD, or the Vikunja null date for ''. */
export function localDateStringToISO(dateStr: string): string {
  if (!dateStr) return NULL_DATE
  return new Date(dateStr + 'T00:00:00').toISOString()
}

/** The quick-pick dates of the date picker as local YYYY-MM-DD strings. */
export function datePickerPresets(now: Date = new Date()): {
  today: string
  tomorrow: string
  nextWeek: string
} {
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  return {
    today: toLocalDateString(now),
    tomorrow: toLocalDateString(tomorrow),
    nextWeek: toLocalDateString(new Date(nextMondayAtMidnightISO(now))),
  }
}
