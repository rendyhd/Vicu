// What a time block is (docs/cross-app-semantics-v1.md section 16.1), one definition for main and
// renderer, the same as Android's TimeBlocks. A block is the task's own start_date and end_date;
// anything else in those fields is not a block and is left alone. Pure: no Electron, no DOM.

import { isNoDueDate } from './due-dates'

/** A block is at most 12 hours. */
export const MAX_BLOCK_MINUTES = 720

type DateValue = string | Date | null | undefined

function instant(value: DateValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  return isNoDueDate(value) ? null : new Date(value as string)
}

/**
 * Both set, the end after the start, at most 12 hours apart, and the end no later than the
 * midnight that ends the start's local day.
 */
export function isTimeBlock(start: DateValue, end: DateValue): boolean {
  const from = instant(start)
  const to = instant(end)
  if (!from || !to) return false
  const minutes = (to.getTime() - from.getTime()) / 60_000
  if (minutes <= 0 || minutes > MAX_BLOCK_MINUTES) return false
  const nextMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
  return to.getTime() <= nextMidnight.getTime()
}
