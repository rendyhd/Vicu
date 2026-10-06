import type { ParsedToken, ParsedRecurrence } from './types'

type RecurrenceUnit = ParsedRecurrence['unit']

const SHORTHAND: Record<string, { interval: number; unit: RecurrenceUnit }> = {
  daily: { interval: 1, unit: 'day' },
  weekly: { interval: 1, unit: 'week' },
  monthly: { interval: 1, unit: 'month' },
  yearly: { interval: 1, unit: 'year' },
  annually: { interval: 1, unit: 'year' },
  biweekly: { interval: 2, unit: 'week' },
  fortnightly: { interval: 2, unit: 'week' },
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
 * A weekday named after "every" ("every monday"). The recurrence token covers only the word
 * "every" while the weekday is still available as the due date; `weekday` is the region of the
 * weekday word, which the caller either leaves to the date extractor (no other date in the
 * input) or claims for the recurrence (another date is present).
 */
export interface WeekdayAnchor {
  start: number
  end: number
}

/**
 * Extract recurrence from input text (docs/cross-app-semantics-v1.md section 5.2).
 * Patterns:
 * - "every N unit", "every unit"
 * - "every <weekday>" (full name): weekly; the weekday is returned as `weekday` so the caller can
 *   use it as the due date
 * - shorthand "daily", "weekly", "monthly", "yearly", "annually", "biweekly", "fortnightly",
 *   only when it is the last word of the remaining input ("Water plants daily"), so adjectives
 *   like "weekly standup" or "Daily review tomorrow" are left alone
 */
export function extractRecurrence(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): { recurrence: ParsedRecurrence | null; tokens: ParsedToken[]; weekday?: WeekdayAnchor } {
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

  // "every monday": weekly. Only the word "every" is consumed here.
  const weekdayRe = /(?:^|(?<=\s))every(\s+)(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?=\s|$)/gi
  while ((match = weekdayRe.exec(input)) !== null) {
    const start = match.index
    const everyEnd = start + 'every'.length
    const weekdayStart = everyEnd + match[1].length
    const weekdayEnd = weekdayStart + match[2].length
    if (consumed.some((c) => start < c.end && weekdayEnd > c.start)) continue
    const recurrence: ParsedRecurrence = { interval: 1, unit: 'week' }
    consumed.push({ start, end: everyEnd })
    tokens.push({
      type: 'recurrence',
      start,
      end: everyEnd,
      value: recurrence,
      raw: input.slice(start, everyEnd),
    })
    return { recurrence, tokens, weekday: { start: weekdayStart, end: weekdayEnd } }
  }

  // Shorthand: "daily", "weekly", etc. Only the last word of what is left counts: when other
  // words follow it, it describes them ("weekly standup", "daily review tomorrow").
  const shorthandRe = /(?:^|(?<=\s))(daily|weekly|monthly|yearly|annually|biweekly|fortnightly)(?=\s|!|$)/gi
  while ((match = shorthandRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((c) => start < c.end && end > c.start)) continue
    if (!isLastWord(input, end, consumed)) continue

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
 * True when nothing but consumed text, whitespace and a lone `!` (the today shortcut) follows
 * `end`: the word at `end` is the last word of the input as it is left after labels, projects
 * and priority were taken out.
 */
function isLastWord(
  input: string,
  end: number,
  consumed: Array<{ start: number; end: number }>,
): boolean {
  let rest = ''
  for (let i = end; i < input.length; i++) {
    if (!consumed.some((c) => i >= c.start && i < c.end)) rest += input[i]
  }
  return /^\s*!?\s*$/.test(rest)
}
