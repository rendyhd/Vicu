import type { ParsedToken } from './types'

/**
 * Extract labels from input text using the given prefix (@ for Todoist, * for Vikunja).
 * Supports quoted labels: @"multi word label" and unquoted: @shopping
 */
export function extractLabels(
  input: string,
  prefix: string,
  consumed: Array<{ start: number; end: number }>,
): { labels: string[]; tokens: ParsedToken[] } {
  const labels: string[] = []
  const tokens: ParsedToken[] = []

  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Quoted labels: @"multi word label" or @'multi word label'
  const quotedRe = new RegExp(
    `(?:^|(?<=\\s))${escapedPrefix}(["'])(.+?)\\1`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = quotedRe.exec(input)) !== null) {
    const label = match[2].trim()
    if (label) {
      labels.push(label)
      const start = match.index
      const end = start + match[0].length
      consumed.push({ start, end })
      tokens.push({
        type: 'label',
        start,
        end,
        value: label,
        raw: match[0],
      })
    }
  }

  // Unquoted labels: @word (must start after whitespace or beginning of string)
  const unquotedRe = new RegExp(
    `(?:^|(?<=\\s))${escapedPrefix}([a-zA-Z][\\w-]*)`,
    'g',
  )
  while ((match = unquotedRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    // Skip if overlapping with already consumed region
    if (consumed.some((c) => start < c.end && end > c.start)) continue
    const label = match[1]
    labels.push(label)
    consumed.push({ start, end })
    tokens.push({
      type: 'label',
      start,
      end,
      value: label,
      raw: match[0],
    })
  }

  return { labels, tokens }
}
