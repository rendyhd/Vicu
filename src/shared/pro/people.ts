/**
 * People (docs/cross-app-semantics-v1.md section 21.5): labels marked as a person
 * (`label_kind.<id>`), their remembered aliases in the ledger, name matching, and the 90-day counts
 * and pattern of decision 9 (plain words, no score). Both apps run the `pro.personMatch` and
 * `pro.personPattern` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { diffLocalDays, localDateOf, type LocalDate } from '../due-dates'
import { activeVerdicts, finalVerdictOf, recordValue, type PromiseValue, type ProLedger } from './ledger'

export interface Person {
  id: number
  title: string
  aliases?: readonly string[]
}

export type PersonMatchKind = 'title' | 'alias' | 'first' | 'none' | 'ambiguous'

export interface PersonMatch {
  id: number | null
  match: PersonMatchKind
}

/** Lower case, trimmed, inner whitespace as one space. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

const firstWord = (name: string): string => normalizeName(name).split(' ')[0] ?? ''

/** The people with their aliases from the ledger. */
export function peopleWithAliases(
  labels: ReadonlyArray<{ id: number; title: string }>,
  isPerson: (labelId: number) => boolean,
  ledger: ProLedger | null | undefined,
): Person[] {
  return labels
    .filter((label) => isPerson(label.id))
    .map((label) => ({ id: label.id, title: label.title, aliases: recordValue(ledger?.people, label.id)?.aliases ?? [] }))
}

/**
 * A name to a person: the title (case and spacing ignored), then a remembered alias, then a unique
 * first name (the name's first word equals the first word of exactly one person's title, and the
 * name is one word or that person's title is the name). Two people with that title or alias is
 * `ambiguous`.
 */
export function matchPerson(name: string, people: readonly Person[]): PersonMatch {
  const wanted = normalizeName(name)
  if (!wanted) return { id: null, match: 'none' }
  const byTitle = people.filter((person) => normalizeName(person.title) === wanted)
  if (byTitle.length === 1) return { id: byTitle[0].id, match: 'title' }
  if (byTitle.length > 1) return { id: null, match: 'ambiguous' }
  const byAlias = people.filter((person) => (person.aliases ?? []).some((alias) => normalizeName(alias) === wanted))
  if (byAlias.length === 1) return { id: byAlias[0].id, match: 'alias' }
  if (byAlias.length > 1) return { id: null, match: 'ambiguous' }
  const first = firstWord(wanted)
  const byFirst = people.filter((person) => firstWord(person.title) === first)
  if (byFirst.length === 1 && (wanted === first || normalizeName(byFirst[0].title).startsWith(wanted))) {
    return { id: byFirst[0].id, match: 'first' }
  }
  if (byFirst.length > 1) return { id: null, match: 'ambiguous' }
  return { id: null, match: 'none' }
}

/** Decision 32: remembering an alias, once, for a person. */
export function withAlias(aliases: readonly string[] | undefined, alias: string): string[] {
  const list = [...(aliases ?? [])]
  const trimmed = alias.trim().replace(/\s+/g, ' ')
  if (trimmed && !list.some((existing) => normalizeName(existing) === normalizeName(trimmed))) list.push(trimmed)
  return list
}

// --- Counts and pattern (decision 9) ------------------------------------------------------------

export const PERSON_WINDOW_DAYS = 90

export interface PersonCounts {
  /** Promises of theirs closed in the window, by how. */
  delivered: number
  late: number
  dropped: number
  takenOver: number
  /** Verdicts given in the window. */
  renegotiated: number
  missed: number
  /** Open now. */
  openTheirs: number
  openMine: number
}

/**
 * Counts for one person over the last 90 local days (`today` included): closed promises of theirs by
 * their final verdict's day, renegotiations and misses by the verdict's day, and what is open now.
 */
export function personCounts(
  personId: number,
  ledger: ProLedger | null | undefined,
  isOpenTask: (taskId: number) => boolean,
  today: LocalDate,
): PersonCounts {
  const counts: PersonCounts = { delivered: 0, late: 0, dropped: 0, takenOver: 0, renegotiated: 0, missed: 0, openTheirs: 0, openMine: 0 }
  const inWindow = (at: string) => {
    const days = diffLocalDays(localDateOf(at), today)
    return days >= 0 && days < PERSON_WINDOW_DAYS
  }
  for (const [id, record] of Object.entries(ledger?.promises ?? {})) {
    const promise = record.value as PromiseValue | null
    if (!promise || promise.person !== personId) continue
    const final = finalVerdictOf(promise)
    if (!final && isOpenTask(Number(id))) {
      if (promise.dir === 'theirs') counts.openTheirs++
      else if (promise.dir === 'mine') counts.openMine++
    }
    if (promise.dir !== 'theirs') continue
    for (const verdict of activeVerdicts(promise)) {
      if (!inWindow(verdict.at)) continue
      if (verdict.kind === 'renegotiated') counts.renegotiated++
      else if (verdict.kind === 'not_yet') counts.missed++
    }
    if (final && inWindow(final.at)) {
      if (final.kind === 'delivered') counts.delivered++
      else if (final.kind === 'late') counts.late++
      else if (final.kind === 'dropped') counts.dropped++
      else if (final.kind === 'taken_over') counts.takenOver++
    }
  }
  return counts
}

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/**
 * The pattern in plain words. First sentence: what was kept, with late, dropped and taken over;
 * second: renegotiations and missed dates, when there are any.
 */
export function patternText(counts: PersonCounts): string {
  const closed = counts.delivered + counts.late + counts.dropped + counts.takenOver
  const sentences: string[] = []
  if (closed === 0) {
    sentences.push('No promises closed in the last 90 days.')
  } else {
    const extra: string[] = []
    if (counts.late) extra.push(`${counts.late} late`)
    if (counts.dropped) extra.push(`${counts.dropped} dropped`)
    if (counts.takenOver) extra.push(`${counts.takenOver} done by you`)
    sentences.push(`Kept ${counts.delivered} of ${closed} on time in the last 90 days${extra.map((part) => `, ${part}`).join('')}.`)
  }
  const changes: string[] = []
  if (counts.renegotiated) changes.push(`asked for a new date ${times(counts.renegotiated)}`)
  if (counts.missed) changes.push(`missed a date ${times(counts.missed)}`)
  if (changes.length) {
    const text = changes.join(' and ')
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`)
  }
  return sentences.join(' ')
}
