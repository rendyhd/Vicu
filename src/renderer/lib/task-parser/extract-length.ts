import { MAX_BLOCK_MINUTES } from '../../../shared/time-blocks'

/**
 * The `for` phrases of the quick-add parser (docs/cross-app-semantics-v1.md section 5.4): `for 30m`,
 * `for 90 min`, `for 2 hours`, `for 1h30m` are lengths; `for 3 days`, `for 2 nights`, `for 3 months`
 * are not, and are never dates either. Finding them is the same on Android (`extractForPhrases`).
 */

const HOURS = '(?:hours?|hrs?|h)'
const MINUTES = '(?:minutes?|mins?|m)'
const LENGTH = `(?:(\\d+)\\s*${HOURS}(?:\\s*(\\d+)\\s*${MINUTES})?|(\\d+)\\s*${MINUTES})`
const OTHER_UNIT = '\\d+\\s*(?:days?|nights?|weeks?|months?|years?)'
const FOR_PHRASE = `(?<=^|\\s)for\\s+(?:${LENGTH}|${OTHER_UNIT})(?=[\\s.,!?;)]|$)`

interface Region {
  start: number
  end: number
}

export interface ForPhrases {
  /** Every phrase: dates are read as if these words were not there, so they never split a date. */
  hidden: Region[]
  /** The first usable length: 1 minute to 12 hours. Whether it makes a block depends on the date. */
  length: (Region & { minutes: number }) | null
}

export function findForPhrases(input: string, consumed: readonly Region[]): ForPhrases {
  const hidden: Region[] = []
  let length: ForPhrases['length'] = null
  for (const match of input.matchAll(new RegExp(FOR_PHRASE, 'gi'))) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((region) => start < region.end && end > region.start)) continue
    hidden.push({ start, end })
    if (length) continue
    const minutes = match[3] !== undefined ? Number(match[3]) : match[1] !== undefined ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0
    if (minutes >= 1 && minutes <= MAX_BLOCK_MINUTES) length = { start, end, minutes }
  }
  return { hidden, length }
}
