import {
  diffLocalDays,
  dueBucket,
  localDateOf,
  startOfLocalDayIso,
  toLocalDate,
} from '../shared/due-dates'

/**
 * Which tasks the daily notification covers, on local calendar days (docs/cross-app-semantics-v1.md
 * section 2): overdue is before today, due today is today whatever the time of day, "upcoming"
 * means tomorrow. Server filters use "before the start of the next local day" instead of an
 * end-of-day `<=`, and the client applies the exact rule on top.
 *
 * Kept free of Electron so it can be unit tested.
 */

const NULL_DATE = '0001-01-01T00:00:00Z'

export type NotificationCategory = 'overdue' | 'due_today' | 'upcoming'

export function notificationFilters(now: Date = new Date()): {
  overdue: string
  dueToday: string
  upcoming: string
} {
  const today = startOfLocalDayIso(0, now)
  const tomorrow = startOfLocalDayIso(1, now)
  const dayAfterTomorrow = startOfLocalDayIso(2, now)
  return {
    overdue: `done = false && due_date < "${today}" && due_date != "${NULL_DATE}"`,
    dueToday: `done = false && due_date >= "${today}" && due_date < "${tomorrow}"`,
    upcoming: `done = false && due_date >= "${tomorrow}" && due_date < "${dayAfterTomorrow}"`,
  }
}

/** The notification bucket of a due date, or null when it is not covered (none, or later than tomorrow). */
export function notificationCategory(dueDate: string, now: Date = new Date()): NotificationCategory | null {
  const bucket = dueBucket(dueDate, now)
  if (bucket === 'overdue') return 'overdue'
  if (bucket === 'today') return 'due_today'
  if (bucket === 'upcoming' && diffLocalDays(toLocalDate(now), localDateOf(dueDate)) === 1) return 'upcoming'
  return null
}

/** Whole calendar days a due date is past (0 for today or later). */
export function overdueDays(dueDate: string, now: Date = new Date()): number {
  const due = localDateOf(dueDate)
  if (!due) return 0
  return Math.max(0, diffLocalDays(due, toLocalDate(now)))
}
