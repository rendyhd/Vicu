import type { ParsedToken } from './types'

/**
 * Extract a project from input text using the given prefix (# for Todoist, + for Vikunja).
 * Only matches when prefix is followed by a letter (not a digit), so #142 is ignored.
 * Supports quoted projects: #"multi word project"
 */
export function extractProject(
  input: string,
  prefix: string,
  consumed: Array<{ start: number; end: number }>,
): { project: string | null; tokens: ParsedToken[] } {
  const tokens: ParsedToken[] = []
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Quoted project: #"multi word"
  const quotedRe = new RegExp(
    `(?:^|(?<=\\s))${escapedPrefix}(["'])(.+?)\\1`,
  )
  const quotedMatch = quotedRe.exec(input)
  if (quotedMatch) {
    const start = quotedMatch.index
    const end = start + quotedMatch[0].length
    if (!consumed.some((c) => start < c.end && end > c.start)) {
      const project = quotedMatch[2].trim()
      if (project) {
        consumed.push({ start, end })
        tokens.push({
          type: 'project',
          start,
          end,
          value: project,
          raw: quotedMatch[0],
        })
        return { project, tokens }
      }
    }
  }

  // Unquoted project: #word (prefix + letter, not digit)
  const unquotedRe = new RegExp(
    `(?:^|(?<=\\s))${escapedPrefix}([a-zA-Z][\\w-]*)`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = unquotedRe.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((c) => start < c.end && end > c.start)) continue
    const project = match[1]
    consumed.push({ start, end })
    tokens.push({
      type: 'project',
      start,
      end,
      value: project,
      raw: match[0],
    })
    return { project, tokens }
  }

  return { project: null, tokens }
}
