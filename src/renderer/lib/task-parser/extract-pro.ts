import { matchPerson, type Person } from '../../../shared/pro/people'
import type { ParsedToken } from './types'

/**
 * Pro's quick-add phrases (docs/cross-app-semantics-v1.md section 5.5), read only while Pro is on:
 * `req:` and a person's `Jan:` / `for Jan:` at the start, `~1h30` estimates and `!flag`. The start
 * date (`starts monday`) is read in `index.ts`, because it needs the date reader. Android has the
 * same rules (`ProPhrases.kt`).
 */

interface Region {
  start: number
  end: number
}

const overlaps = (consumed: readonly Region[], start: number, end: number) =>
  consumed.some((region) => start < region.end && end > region.start)

export interface PersonPrefix {
  id: number
  /** `for Jan:`: your promise to them. */
  mine: boolean
  start: number
  end: number
}

/** `req:` at the very start (after spaces). */
export function extractRequest(input: string, consumed: Region[]): { request: boolean; tokens: ParsedToken[] } {
  const match = /^\s*req:\s*/i.exec(input)
  if (!match || match[0].trim() === '' || overlaps(consumed, 0, match[0].length)) return { request: false, tokens: [] }
  const start = match[0].length - match[0].trimStart().length
  consumed.push({ start, end: match[0].length })
  return { request: true, tokens: [{ type: 'request', start, end: match[0].length, value: true, raw: match[0].trim() }] }
}

/**
 * A known person's name and a colon at the start (after `req:`, when there is one), then a space.
 * The name is one to three words; it must match one person (section 21.5).
 */
export function extractPersonPrefix(
  input: string,
  people: readonly Person[],
  consumed: Region[],
): { person: PersonPrefix | null; tokens: ParsedToken[] } {
  if (!people.length) return { person: null, tokens: [] }
  const from = consumed.filter((region) => region.start === 0 || input.slice(0, region.start).trim() === '').reduce((max, region) => Math.max(max, region.end), 0)
  const rest = input.slice(from)
  const match = /^(\s*)(for\s+)?([\p{L}][\p{L}'.-]*(?:\s+[\p{L}][\p{L}'.-]*){0,2}):\s+/iu.exec(rest)
  if (!match) return { person: null, tokens: [] }
  const found = matchPerson(match[3], people)
  if (found.id === null) return { person: null, tokens: [] }
  const start = from + match[1].length
  const end = from + match[0].length
  if (overlaps(consumed, start, end)) return { person: null, tokens: [] }
  consumed.push({ start, end })
  const person = { id: found.id, mine: !!match[2], start, end }
  return { person, tokens: [{ type: 'person', start, end, value: person, raw: input.slice(start, end).trim() }] }
}

const ESTIMATE = /(?<=^|\s)~(?:(\d{1,2})h(?:(\d{1,2})(?:m|min)?)?|(\d{1,4})(?:m|min))(?=[\s.,!?;)]|$)/gi

/** `~10m`, `~45min`, `~1h`, `~1h30`, `~1h30m`: minutes, 1 to 1440. */
export function extractEstimate(input: string, consumed: Region[]): { estimate: number | null; tokens: ParsedToken[] } {
  for (const match of input.matchAll(ESTIMATE)) {
    const start = match.index
    const end = start + match[0].length
    if (overlaps(consumed, start, end)) continue
    const minutes = match[3] !== undefined ? Number(match[3]) : Number(match[1]) * 60 + Number(match[2] ?? 0)
    if (minutes < 1 || minutes > 1440) continue
    consumed.push({ start, end })
    return { estimate: minutes, tokens: [{ type: 'estimate', start, end, value: minutes, raw: match[0] }] }
  }
  return { estimate: null, tokens: [] }
}

/** The word `!flag`, any case. */
export function extractFlag(input: string, consumed: Region[]): { flag: boolean; tokens: ParsedToken[] } {
  for (const match of input.matchAll(/(?<=^|\s)!flag(?=[\s.,;)]|$)/gi)) {
    const start = match.index
    const end = start + match[0].length
    if (overlaps(consumed, start, end)) continue
    consumed.push({ start, end })
    return { flag: true, tokens: [{ type: 'flag', start, end, value: true, raw: match[0] }] }
  }
  return { flag: false, tokens: [] }
}

/** Where `starts` begins a start-date phrase: the word and the index right after its spaces. */
export function findStartsWords(input: string, consumed: readonly Region[]): Array<{ start: number; phrase: number }> {
  const found: Array<{ start: number; phrase: number }> = []
  for (const match of input.matchAll(/(?<=^|\s)starts\s+/gi)) {
    const start = match.index
    const phrase = start + match[0].length
    if (!overlaps(consumed, start, phrase)) found.push({ start, phrase })
  }
  return found
}
