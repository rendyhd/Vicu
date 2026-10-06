import * as chrono from 'chrono-node'
import { startOfLocalDay } from '../due-dates'
import type { ParsedToken } from './types'

/**
 * Extract a date from input text using chrono-node.
 * Returns the parsed date, whether the text named a time of day (`hasTime`, chrono's
 * `start.isCertain('hour')`), and token position info. Without a time the time of `dueDate`
 * is whatever chrono implied and must not be used (see `parsedDue` in ../due-dates).
 */
export function extractDate(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): { dueDate: Date | null; hasTime: boolean; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []

  // Build a working string with consumed regions replaced by spaces
  const working = buildWorkingText(input, consumed)

  const results = chrono.parse(working, new Date(), { forwardDate: true })
  if (results.length === 0) return { dueDate: null, hasTime: false, tokens }

  // Use the first result whose matched text isn't a standalone "now".
  // Chrono treats "now" as the current time, but we don't want a casual
  // "do this now" to get tagged with a due date.
  const result = results.find((r) => r.text.trim().toLowerCase() !== 'now')
  if (!result) return { dueDate: null, hasTime: false, tokens }

  const start = result.index
  const end = start + result.text.length

  // Verify the matched region doesn't overlap with already-consumed regions
  if (consumed.some((c) => start < c.end && end > c.start)) {
    return { dueDate: null, hasTime: false, tokens }
  }

  const dueDate = result.start.date()
  const hasTime = result.start.isCertain('hour')
  consumed.push({ start, end })
  tokens.push({
    type: 'date',
    start,
    end,
    value: dueDate,
    raw: input.slice(start, end),
  })

  return { dueDate, hasTime, tokens }
}

/**
 * Extract the `!` → today shortcut. This is independent of the NLP parser
 * and always runs (even when parser is disabled).
 *
 * Matches:
 * - Trailing `!` (with optional preceding whitespace): "call dentist !" or "call dentist!"
 * - Leading `!` (with optional following whitespace): "! call dentist" or "!call dentist"
 *   BUT NOT when followed by a priority token like `!1`, `!urgent`, `!high`, `!medium`, `!low`
 * - Standalone `!`
 */
export function extractBangToday(input: string): {
  title: string
  dueDate: Date | null
} {
  const trimmed = input.trim()

  // The result is a date-only value: callers build the due date with `dueToday()` /
  // `parsedDue(date, false)`, so only the local calendar day of `dueDate` matters.
  const today = startOfLocalDay(new Date())

  // Standalone `!`
  if (trimmed === '!') {
    return { title: '', dueDate: today }
  }

  // Match trailing `!` at end of string (not `!word` or `!digit`)
  const trailingRe = /^(.+?)\s*!$/
  const trailingMatch = trailingRe.exec(trimmed)
  if (trailingMatch) {
    return { title: trailingMatch[1].trim(), dueDate: today }
  }

  // Match leading `!` at start of string, but NOT if followed by a priority token
  // Priority tokens: !1-!4, !urgent, !high, !medium, !low
  const leadingRe = /^!\s*(.+)$/
  const leadingMatch = leadingRe.exec(trimmed)
  if (leadingMatch) {
    // Check that the text after `!` doesn't start with a priority token
    const rest = leadingMatch[1]
    if (!/^[1-4](?:\s|$)/.test(rest) && !/^(?:urgent|high|medium|low)(?:\s|$)/i.test(rest)) {
      return { title: rest.trim(), dueDate: today }
    }
  }

  return { title: input, dueDate: null }
}

function buildWorkingText(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): string {
  const chars = input.split('')
  for (const c of consumed) {
    for (let i = c.start; i < c.end; i++) {
      if (i < chars.length) chars[i] = ' '
    }
  }
  return chars.join('')
}
