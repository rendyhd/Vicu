import type { ParsedToken } from './types'

/** Extract the first standalone `~XX` token, where XX is a positive whole number of minutes. */
export function extractDuration(
  input: string,
  consumed: Array<{ start: number; end: number }>,
): { durationMinutes: number | null; tokens: ParsedToken[] } {
  const pattern = /(?:^|(?<=\s))~([1-9]\d*)(?=\s|$)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (consumed.some((region) => start < region.end && end > region.start)) continue
    const durationMinutes = Number(match[1])
    if (!Number.isSafeInteger(durationMinutes)) continue
    consumed.push({ start, end })
    return {
      durationMinutes,
      tokens: [{ type: 'duration', start, end, value: durationMinutes, raw: match[0] }],
    }
  }
  return { durationMinutes: null, tokens: [] }
}
