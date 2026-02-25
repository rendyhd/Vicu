import type { ParsedToken, ParsedRecurrence } from './types'

type RecurrenceUnit = ParsedRecurrence['unit']

const SHORTHAND: Record<string, { interval: number; unit: RecurrenceUnit }> = {
  daily: { interval: 1, unit: 'day' },
  weekly: { interval: 1, unit: 'week' },
  monthly: { interval: 1, unit: 'month' },
  yearly: { interval: 1, unit: 'year' },
  annually: { interval: 1, unit: 'year' },
}

const UNIT_MAP: Record<string, RecurrenceUnit> = {
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
}

/**
 * Extract recurrence from input text.
 * Patterns: "every N unit", "every unit", "daily", "weekly", "monthly", "yearly"
 *
 * Standalone check: shorthand words like "daily" or "weekly" are only matched
 * when they appear as standalone words (not part of "weekly standup" etc.)
 * — they must be the ENTIRE remaining input or bounded by consumed regions.
 */
export function extractRecurrence(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): { recurrence: ParsedRecurrence | null; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []

  // "every N unit" or "every unit"
  const everyRe = /(?:^|(?<=\s))every\s+(\d+\s+)?(days?|weeks?|months?|years?)(?=\s|$)/gi
  let match: RegExpExecArray | null
  while ((match = everyRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((c) => start < c.end && end > c.start)) continue
    const interval = match[1] ? parseInt(match[1].trim(), 10) : 1
    const unit = UNIT_MAP[match[2].toLowerCase()]
    if (!unit) continue
    const recurrence: ParsedRecurrence = { interval, unit }
    consumed.push({ start, end })
    tokens.push({
      type: 'recurrence',
      start,
      end,
      value: recurrence,
      raw: match[0],
    })
    return { recurrence, tokens }
  }

  // Shorthand: "daily", "weekly", etc.
  // Only match if the word is standalone — not followed or preceded by non-whitespace
  // that isn't already consumed.
  const shorthandRe = /(?:^|(?<=\s))(daily|weekly|monthly|yearly|annually)(?=\s|$)/gi
  while ((match = shorthandRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((c) => start < c.end && end > c.start)) continue

    // Standalone check: verify this word isn't adjacent to other non-consumed text
    // that would make it part of a compound phrase like "weekly standup"
    if (!isStandalone(input, start, end, consumed)) continue

    const word = match[1].toLowerCase()
    const recurrence = { ...SHORTHAND[word] }
    consumed.push({ start, end })
    tokens.push({
      type: 'recurrence',
      start,
      end,
      value: recurrence,
      raw: match[0],
    })
    return { recurrence, tokens }
  }

  return { recurrence: null, tokens }
}

/**
 * Check if the word at [start, end] is standalone — meaning the remaining
 * non-consumed text around it doesn't form a phrase.
 * Returns true only if all surrounding non-consumed text is empty.
 */
function isStandalone(
  input: string,
  start: number,
  end: number,
  consumed: Array<{ start: number; end: number }>,
): boolean {
  // Build a set of consumed character positions
  const isConsumed = new Set<number>()
  for (const c of consumed) {
    for (let i = c.start; i < c.end; i++) isConsumed.add(i)
  }
  // Also mark our candidate as consumed
  for (let i = start; i < end; i++) isConsumed.add(i)

  // Check if there's any non-whitespace, non-consumed character in the input
  for (let i = 0; i < input.length; i++) {
    if (!isConsumed.has(i) && input[i].trim() !== '') {
      return false
    }
  }
  return true
}
