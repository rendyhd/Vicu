import type { ParsedRecurrence } from './types'

const DAY = 86400
const WEEK = 604800
const YEAR = 365 * DAY

/**
 * Convert parsed recurrence to Vikunja's repeat_after / repeat_mode format.
 * Reuses the same constants as src/renderer/lib/recurrence.ts.
 */
export function recurrenceToVikunja(r: ParsedRecurrence): {
  repeat_after: number
  repeat_mode: number
} {
  switch (r.unit) {
    case 'day':
      return { repeat_after: r.interval * DAY, repeat_mode: 0 }
    case 'week':
      return { repeat_after: r.interval * WEEK, repeat_mode: 0 }
    case 'month':
      // Vikunja uses repeat_mode=1 for monthly, repeat_after=0
      // For "every N months", we use repeat_after=N-1 as a count hint
      // but for simple monthly, it's repeat_after=0, repeat_mode=1
      if (r.interval === 1) {
        return { repeat_after: 0, repeat_mode: 1 }
      }
      // Multi-month: approximate with days (Vikunja doesn't natively support "every N months")
      return { repeat_after: r.interval * 30 * DAY, repeat_mode: 0 }
    case 'year':
      return { repeat_after: r.interval * YEAR, repeat_mode: 0 }
  }
}
