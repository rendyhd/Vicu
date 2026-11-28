/**
 * The day a week starts on (docs/cross-app-semantics-v1.md, section 2.1): the synced preference
 * `week_start`. Monday is the default and is written as `null`; any value the registry does not
 * name acts as Monday. Android has the same in `util/WeekStart.kt`.
 *
 * It decides calendars, "this week" and which week "next week" is. It never changes a schedule:
 * "every 2 weeks" in a routine or an Event keeps counting from Monday, so those callers pass
 * `'monday'` themselves.
 *
 * The week helpers of `due-dates.ts` take the week start as their last argument and use
 * `getWeekStart()` when it is left out. Each process sets it from the synced preferences
 * (`setWeekStart`): main where it keeps them, a window where it reads them.
 */

export type WeekStart = 'monday' | 'sunday' | 'saturday'

export const DEFAULT_WEEK_START: WeekStart = 'monday'

export const WEEK_START_KEY = 'week_start'

/** The choices in the order the setting offers them. */
export const WEEK_START_CHOICES: ReadonlyArray<{ value: WeekStart; label: string }> = [
  { value: 'monday', label: 'Monday' },
  { value: 'sunday', label: 'Sunday' },
  { value: 'saturday', label: 'Saturday' },
]

/** ISO weekday (1 Monday to 7 Sunday) of each week start. */
const ISO_DAY: Record<WeekStart, number> = { monday: 1, sunday: 7, saturday: 6 }

export function weekStartLabel(weekStart: WeekStart): string {
  return WEEK_START_CHOICES.find((choice) => choice.value === weekStart)?.label ?? 'Monday'
}

/** The week start a stored value gives; anything but the two written names is the default. */
export function readWeekStart(value: unknown): WeekStart {
  return value === 'sunday' || value === 'saturday' ? value : DEFAULT_WEEK_START
}

/** What the preference holds for a week start: `null` for the default, so the reset reaches every device. */
export function writeWeekStart(weekStart: WeekStart): WeekStart | null {
  return weekStart === DEFAULT_WEEK_START ? null : weekStart
}

/** Vikunja's `settings.week_start` (0 Sunday to 6 Saturday) as a week start; null for a day Vicu does not offer. */
export function weekStartOfVikunja(value: unknown): WeekStart | null {
  if (value === 0) return 'sunday'
  if (value === 1) return 'monday'
  if (value === 6) return 'saturday'
  return null
}

/**
 * The day the setting offers to take over from the Vikunja account: its week start while it is one
 * of the three and differs from the one in use. Null: nothing to offer.
 */
export function weekStartOffer(vikunja: unknown, inUse: WeekStart): WeekStart | null {
  const theirs = weekStartOfVikunja(vikunja)
  return theirs !== null && theirs !== inUse ? theirs : null
}

/** How many days an ISO weekday is into a week: 0 for the first day, 6 for the last. */
export function daysIntoWeek(isoWeekday: number, weekStart: WeekStart): number {
  return (isoWeekday - ISO_DAY[weekStart] + 7) % 7
}

/** The seven ISO weekdays (1 Monday to 7 Sunday) in the order of a week. */
export function weekdaysOf(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => ((ISO_DAY[weekStart] - 1 + i) % 7) + 1)
}

let current: WeekStart = DEFAULT_WEEK_START

/** The account's week start as this process last read it from the synced preferences. */
export function getWeekStart(): WeekStart {
  return current
}

export function setWeekStart(weekStart: WeekStart): void {
  current = weekStart
}
