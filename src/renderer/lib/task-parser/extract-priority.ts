import type { ParsedToken, SyntaxMode } from './types'

/**
 * Extract priority from input text.
 * - Todoist mode: p1 (urgent) through p4 (low) — word boundary enforced
 * - Vikunja mode: !1 through !4 — word boundary enforced
 * - Shared: !urgent, !high, !medium, !low (both modes)
 *
 * Priority mapping:
 *   Todoist p1 / !urgent → Vikunja 4 (urgent)
 *   Todoist p2 / !high   → Vikunja 3 (high)
 *   Todoist p3 / !medium → Vikunja 2 (medium)
 *   Todoist p4 / !low    → Vikunja 1 (low)
 */

const WORD_PRIORITIES: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// Todoist inverts: p1 = highest urgency → Vikunja 4
const TODOIST_MAP: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 }

export function extractPriority(
  input: string,
  mode: SyntaxMode,
  consumed: Array<{ start: number; end: number }>,
): { priority: number | null; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []

  // Word-based priority: !urgent, !high, !medium, !low (both modes)
  const wordRe = /(?:^|(?<=\s))!(urgent|high|medium|low)(?=\s|$)/gi
  let match: RegExpExecArray | null
  while ((match = wordRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((c) => start < c.end && end > c.start)) continue
    const word = match[1].toLowerCase()
    const priority = WORD_PRIORITIES[word]
    consumed.push({ start, end })
    tokens.push({
      type: 'priority',
      start,
      end,
      value: priority,
      raw: match[0],
    })
    return { priority, tokens }
  }

  if (mode === 'todoist') {
    // Todoist: p1-p4 with word boundary
    const re = /(?:^|(?<=\s))p([1-4])(?=\s|$)/g
    while ((match = re.exec(input)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (consumed.some((c) => start < c.end && end > c.start)) continue
      const num = parseInt(match[1], 10)
      const priority = TODOIST_MAP[num]
      consumed.push({ start, end })
      tokens.push({
        type: 'priority',
        start,
        end,
        value: priority,
        raw: match[0],
      })
      return { priority, tokens }
    }
  } else {
    // Vikunja: !1-!4 with word boundary
    const re = /(?:^|(?<=\s))!([1-4])(?=\s|$)/g
    while ((match = re.exec(input)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (consumed.some((c) => start < c.end && end > c.start)) continue
      const priority = parseInt(match[1], 10)
      consumed.push({ start, end })
      tokens.push({
        type: 'priority',
        start,
        end,
        value: priority,
        raw: match[0],
      })
      return { priority, tokens }
    }
  }

  return { priority: null, tokens }
}
