/**
 * Working days (docs/cross-app-semantics-v1.md section 21.18): the ISO weekdays the setting
 * `workdays` lists, Monday to Friday unless set. Public holidays are not known. Both apps run the
 * `pro.workingDays` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, isoWeekday, type LocalDate } from '../due-dates'

export const DEFAULT_WORKDAYS: readonly number[] = [1, 2, 3, 4, 5]
export const DEFAULT_CHECK_DAYS = 2
export const MAX_CHECK_DAYS = 10

/** The setting as a clean list: whole numbers 1 to 7, once each, in order; the default when none is left. */
export function readWorkdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKDAYS]
  const days = [...new Set(value.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b)
  return days.length ? days : [...DEFAULT_WORKDAYS]
}

/** How many working days before its due day a check comes up: 2 unless set, 0 to 10. */
export function readCheckDays(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CHECK_DAYS ? value : DEFAULT_CHECK_DAYS
}

export function isWorkingDay(day: LocalDate, workdays: readonly number[] = DEFAULT_WORKDAYS): boolean {
  return workdays.includes(isoWeekday(day))
}

/**
 * The day `n` working days before `day`, counting back from the day before it; 0 is the day itself.
 */
export function workingDaysBefore(day: LocalDate, n: number, workdays: readonly number[] = DEFAULT_WORKDAYS): LocalDate {
  const days = workdays.length ? workdays : DEFAULT_WORKDAYS
  let current = day
  let left = Math.max(0, Math.floor(n))
  while (left > 0) {
    current = addLocalDays(current, -1)
    if (days.includes(isoWeekday(current))) left--
  }
  return current
}
