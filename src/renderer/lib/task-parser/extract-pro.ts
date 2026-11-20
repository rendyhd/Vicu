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

export type DollarPerson =
  | { id: number; mine: boolean; start: number; end: number }
  | { id: null; name: string; mine: boolean; start: number; end: number }

// `for` (optional), `$`, then a quoted name or a name starting with a letter; a `:` right after the
// name belongs to the phrase. The name ends at a space, the end or one of . , ; : ! ? )
const DOLLAR_PERSON = /(?<=^|\s)(for\s+)?\$(?:"([^"\n]+)"|(\p{L}[\p{L}\p{N}_'-]*(?:\.[\p{L}\p{N}_'-]+)*))(:)?(?=[\s.,;:!?)]|$)/giu

/**
 * `$Lalith`, `$"Jan de Vries"` or `for $Priya` anywhere (section 5.5): the first one only, and none
 * after a `Jan:` prefix. A name that matches nobody is a new person; an ambiguous one stays.
 */
export function extractDollarPerson(
  input: string,
  people: readonly Person[],
  consumed: Region[],
): { person: DollarPerson | null; tokens: ParsedToken[] } {
  for (const match of input.matchAll(DOLLAR_PERSON)) {
    const start = match.index
    const end = start + match[0].length
    if (overlaps(consumed, start, end)) continue
    const name = (match[2] ?? match[3]).trim().replace(/\s+/g, ' ')
    if (!name) return { person: null, tokens: [] }
    const found = matchPerson(name, people)
    if (found.match === 'ambiguous') return { person: null, tokens: [] }
    const mine = !!match[1]
    const person: DollarPerson = found.id !== null ? { id: found.id, mine, start, end } : { id: null, name, mine, start, end }
    consumed.push({ start, end })
    return { person, tokens: [{ type: 'person', start, end, value: person, raw: match[0] }] }
  }
  return { person: null, tokens: [] }
}

export type DollarRequester = { id: number; start: number; end: number } | { id: null; name: string; start: number; end: number }

/**
 * Who it was promised to (section 5.5): exactly two `$` phrases, exactly one of them after `for`.
 * The plain one is the owner and the `for` one the requester. Null when the text is not of that
 * shape or a name is ambiguous: the caller then reads the first phrase only, as before.
 */
export function extractOwnerAndRequester(
  input: string,
  people: readonly Person[],
  consumed: Region[],
): { person: DollarPerson; requester: DollarRequester; tokens: ParsedToken[] } | null {
  const matches = [...input.matchAll(DOLLAR_PERSON)].filter((match) => !overlaps(consumed, match.index, match.index + match[0].length))
  if (matches.length !== 2 || matches.filter((match) => !!match[1]).length !== 1) return null
  const read = (match: RegExpMatchArray) => {
    const start = match.index as number
    const end = start + match[0].length
    const name = (match[2] ?? match[3]).trim().replace(/\s+/g, ' ')
    const found = name ? matchPerson(name, people) : null
    return { start, end, name, found, raw: match[0] }
  }
  const owner = read(matches.find((match) => !match[1]) as RegExpMatchArray)
  const asked = read(matches.find((match) => !!match[1]) as RegExpMatchArray)
  if (!owner.found || !asked.found || owner.found.match === 'ambiguous' || asked.found.match === 'ambiguous') return null
  const person: DollarPerson = owner.found.id !== null
    ? { id: owner.found.id, mine: false, start: owner.start, end: owner.end }
    : { id: null, name: owner.name, mine: false, start: owner.start, end: owner.end }
  const requester: DollarRequester = asked.found.id !== null
    ? { id: asked.found.id, start: asked.start, end: asked.end }
    : { id: null, name: asked.name, start: asked.start, end: asked.end }
  consumed.push({ start: owner.start, end: owner.end }, { start: asked.start, end: asked.end })
  return {
    person,
    requester,
    tokens: [
      { type: 'person', start: owner.start, end: owner.end, value: person, raw: owner.raw },
      { type: 'requester', start: asked.start, end: asked.end, value: requester, raw: asked.raw },
    ],
  }
}

/** Where `check on` begins a check-date phrase: the words and the index right after their spaces. */
export function findCheckOnWords(input: string, consumed: readonly Region[]): Array<{ start: number; phrase: number }> {
  const found: Array<{ start: number; phrase: number }> = []
  for (const match of input.matchAll(/(?<=^|\s)check\s+on\s+/gi)) {
    const start = match.index
    const phrase = start + match[0].length
    if (!overlaps(consumed, start, phrase)) found.push({ start, phrase })
  }
  return found
}

const ESTIMATE =/(?<=^|\s)~(?:(\d{1,2})h(?:(\d{1,2})(?:m|min)?)?|(\d{1,4})(?:m|min))(?=[\s.,!?;)]|$)/gi

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
