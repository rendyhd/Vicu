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
 * Only matches a trailing `!` (with optional preceding whitespace) or a standalone `!`.
 */
export function extractBangToday(input: string): {
  title: string
  dueDate: Date | null
} {
  // Match trailing `!` at end of string (not `!word` or `!digit`)
  const bangRe = /^(.+?)\s*!$/
  const match = bangRe.exec(input.trim())
  if (match) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return { title: match[1].trim(), dueDate: today }
  }

  // Standalone `!`
  if (input.trim() === '!') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return { title: '', dueDate: today }
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
