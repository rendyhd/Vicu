import * as chrono from 'chrono-node'
import type { ParsedToken } from './types'

/**
 * Extract a date from input text using chrono-node.
 * Returns the parsed date and token position info.
 */
export function extractDate(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): { dueDate: Date | null; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []

  // Build a working string with consumed regions replaced by spaces
  const working = buildWorkingText(input, consumed)

  const results = chrono.parse(working, new Date(), { forwardDate: true })
  if (results.length === 0) return { dueDate: null, tokens }

  // Use the first result
  const result = results[0]
  const start = result.index
  const end = start + result.text.length

  // Verify the matched region doesn't overlap with already-consumed regions
  if (consumed.some((c) => start < c.end && end > c.start)) {
    return { dueDate: null, tokens }
  }

  const dueDate = result.start.date()
  consumed.push({ start, end })
  tokens.push({
    type: 'date',
    start,
    end,
    value: dueDate,
    raw: input.slice(start, end),
  })

  return { dueDate, tokens }
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

  // Standalone `!`
  if (trimmed === '!') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return { title: '', dueDate: today }
  }

  // Match trailing `!` at end of string (not `!word` or `!digit`)
  const trailingRe = /^(.+?)\s*!$/
  const trailingMatch = trailingRe.exec(trimmed)
  if (trailingMatch) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
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
      const today = new Date()
      today.setHours(0, 0, 0, 0)
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
