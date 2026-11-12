/**
 * Import and export (docs/cross-app-semantics-v1.md section 21.12): the `vicu-import/1` JSON a
 * Copilot answer (or anyone) pastes in, read forgivingly; matched against the people, initiatives
 * and open promises; turned into a plan that changes nothing until Add (decision 30). The export is
 * the same format with ids for the round trip (decision 33). Both apps run the `pro.importRead`,
 * `pro.importMatch`, `pro.importDates` and `pro.copilotPrompt` vectors (the screens are desktop
 * only).
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, endOfMonth, isoWeekday, nextWeekStart, type LocalDate } from '../due-dates'
import { matchPerson, type Person, type PersonMatch } from './people'
import { confirmTitle } from './promises'

export const IMPORT_FORMAT = 'vicu-import/1'

export const IMPORT_TYPES = ['promise', 'action', 'update', 'open_item', 'decision', 'decision_needed', 'value'] as const
export type ImportType = (typeof IMPORT_TYPES)[number]

export const IMPORT_STATUSES = ['delivered', 'late', 'not_yet', 'renegotiated', 'dropped'] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** The fields each type reads; anything else is reported and ignored. */
const FIELDS: Record<ImportType, readonly string[]> = {
  promise: ['owner', 'what', 'due', 'initiative', 'in_their_words', 'done_when', 'needs'],
  action: ['owner', 'what', 'due', 'for', 'initiative'],
  update: ['id', 'owner', 'about', 'what', 'status', 'new_due', 'blocker'],
  open_item: ['what', 'ask', 'initiative'],
  decision: ['what', 'by', 'initiative', 'date'],
  decision_needed: ['what', 'from', 'initiative'],
  value: ['what', 'where', 'initiative'],
}

export interface ImportSource {
  kind: string
  title: string
  date: LocalDate | null
}

export interface ImportItem {
  /** 1-based position in the pasted items. */
  index: number
  type: ImportType
  what: string
  owner?: string | null
  due?: LocalDate | null
  initiative?: string | null
  in_their_words?: string | null
  done_when?: string | null
  needs?: string[]
  for?: string | null
  id?: string | null
  about?: string | null
  status?: ImportStatus | null
  new_due?: LocalDate | null
  blocker?: string | null
  ask?: string | null
  by?: string | null
  from?: string | null
  where?: string | null
  date?: LocalDate | null
}

export interface ReadImport {
  ok: boolean
  source: ImportSource
  items: ImportItem[]
  /** Plain sentences about what was not read; never fatal unless `ok` is false. */
  problems: string[]
}

// --- Reading ---------------------------------------------------------------------------------------

/** The text between the outermost braces, without code fences, and with trailing commas removed. */
export function extractJson(text: string): string | null {
  const unfenced = text.replace(/^[ \t]*```[^\n]*$/gm, '')
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const body = unfenced.slice(start, end + 1)
  let out = ''
  let inString = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += body[++i] ?? ''
      } else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < body.length && /\s/.test(body[j])) j++
      if (body[j] === '}' || body[j] === ']') continue
    }
    out += ch
  }
  return out
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/**
 * A date as the import reads it, relative to `ref` (the source date): `YYYY-MM-DD` (a time after it
 * is ignored), `today`, `tomorrow`, a weekday (full or three letters, optionally after "on", "this"
 * or "next": the first such day after `ref`), `next week` (Monday of next week), `end of week`
 * (the first Friday on or after `ref`), `end of month`, `in N days`, `in N weeks`. Anything else is
 * not read (null).
 */
export function readImportDate(text: string, ref: LocalDate): LocalDate | null {
  const value = text.trim().toLowerCase()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[t ][\d:.]+(?:z|[+-]\d{2}:?\d{2})?)?$/.exec(value)
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
  }
  if (value === 'today') return ref
  if (value === 'tomorrow') return addLocalDays(ref, 1)
  if (value === 'next week') return nextWeekStart(ref)
  if (value === 'end of month') return endOfMonth(ref)
  if (value === 'end of week' || value === 'end of the week') {
    const offset = (5 - isoWeekday(ref) + 7) % 7
    return addLocalDays(ref, offset)
  }
  const inN = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(value)
  if (inN) return addLocalDays(ref, Number(inN[1]) * (inN[2].startsWith('week') ? 7 : 1))
  const weekday = /^(?:(?:on|this|next) )?([a-z]+)$/.exec(value)
  if (weekday) {
    const index = WEEKDAYS.findIndex((name) => name === weekday[1] || name.slice(0, 3) === weekday[1])
    if (index >= 0) {
      const offset = ((index + 1 - isoWeekday(ref) + 7) % 7) || 7
      return addLocalDays(ref, offset)
    }
  }
  return null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

function readStatus(value: unknown): ImportStatus | null {
  const raw = text(value)
  if (!raw) return null
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'done' || key === 'completed' || key === 'complete') return 'delivered'
  if (key === 'notyet' || key === 'delayed' || key === 'missed') return 'not_yet'
  if (key === 'cancelled' || key === 'canceled') return 'dropped'
  return (IMPORT_STATUSES as readonly string[]).includes(key) ? (key as ImportStatus) : null
}

/**
 * Reads pasted text. Not JSON, or no items: `ok` false. A different or missing format, unknown types
 * and fields, dates that are not read and items without `what` are reported; the rest is read.
 */
export function readImport(input: string, today: LocalDate): ReadImport {
  const empty: ReadImport = { ok: false, source: { kind: 'meeting', title: '', date: null }, items: [], problems: [] }
  const json = extractJson(input)
  let parsed: unknown
  try {
    parsed = json === null ? undefined : JSON.parse(json)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...empty, problems: ['The text is not a vicu-import/1 document.'] }
  }
  const document = parsed as Record<string, unknown>
  const problems: string[] = []
  const format = text(document.format)
  if (format === null) problems.push('No format given; read as vicu-import/1.')
  else if (format !== IMPORT_FORMAT) problems.push(`Written as ${format}; read as vicu-import/1.`)
  const rawSource = document.source && typeof document.source === 'object' && !Array.isArray(document.source)
    ? (document.source as Record<string, unknown>)
    : {}
  const sourceDate = text(rawSource.date)
  const date = sourceDate ? readImportDate(sourceDate, today) : null
  if (sourceDate && !date) problems.push(`Source date "${sourceDate}" not read; dates count from today.`)
  const source: ImportSource = { kind: text(rawSource.kind)?.toLowerCase() ?? 'meeting', title: text(rawSource.title) ?? '', date }
  const ref = date ?? today
  if (!Array.isArray(document.items) || document.items.length === 0) {
    return { ok: false, source, items: [], problems: [...problems, 'No items found.'] }
  }
  const items: ImportItem[] = []
  document.items.forEach((raw, position) => {
    const index = position + 1
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`Item ${index} is not an object; left out.`)
      return
    }
    const fields = raw as Record<string, unknown>
    const type = text(fields.type)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
    if (!(IMPORT_TYPES as readonly string[]).includes(type)) {
      problems.push(`Item ${index}: unknown type "${text(fields.type) ?? ''}"; left out.`)
      return
    }
    const known = FIELDS[type as ImportType]
    const unknown = Object.keys(fields).filter((key) => key !== 'type' && !known.includes(key))
    if (unknown.length) problems.push(`Item ${index}: ${unknown.map((key) => `"${key}"`).join(', ')} ignored.`)
    const item: ImportItem = { index, type: type as ImportType, what: text(fields.what) ?? '' }
    const readDate = (key: 'due' | 'new_due' | 'date') => {
      const words = text(fields[key])
      if (words === null) return
      const day = readImportDate(words, ref)
      if (day) item[key] = day
      else problems.push(`Item ${index}: ${key} "${words}" not read.`)
    }
    for (const key of ['owner', 'initiative', 'in_their_words', 'done_when', 'for', 'id', 'about', 'blocker', 'ask', 'by', 'from', 'where'] as const) {
      if (known.includes(key) && text(fields[key]) !== null) item[key] = text(fields[key])
    }
    if (known.includes('due')) readDate('due')
    if (known.includes('new_due')) readDate('new_due')
    if (known.includes('date')) readDate('date')
    if (known.includes('needs') && Array.isArray(fields.needs)) {
      item.needs = fields.needs.map((need) => (typeof need === 'string' || typeof need === 'number' ? String(need).trim() : '')).filter(Boolean)
    }
    if (type === 'update') {
      item.status = readStatus(fields.status)
      if (!item.status) problems.push(`Item ${index}: status "${text(fields.status) ?? ''}" not read.`)
    }
    if (!item.what && type !== 'update') {
      problems.push(`Item ${index}: no "what"; left out.`)
      return
    }
    items.push(item)
  })
  return { ok: items.length > 0, source, items, problems }
}

// --- Matching ----------------------------------------------------------------------------------------

export interface ImportInitiative {
  id: number
  title: string
}

export interface ImportOpenPromise {
  taskId: number
  person: number
  title: string
  dir: string
}

export interface ImportWorld {
  people: readonly Person[]
  /** The initiatives inside the area. */
  initiatives: readonly ImportInitiative[]
  openPromises: readonly ImportOpenPromise[]
}

export type ImportAction =
  | 'their_promise'
  | 'confirm'
  | 'my_task'
  | 'verdict'
  | 'open_item'
  | 'decision'
  | 'owed'
  | 'value'

export interface ImportRow {
  index: number
  type: ImportType
  action: ImportAction
  /** Who: the owner, `for`, `ask`, `by` or `from` depending on the type; `me` is no person. */
  name: string | null
  person: PersonMatch
  initiative: number | null
  /** The initiative's name as written, when it matched none. */
  initiativeName: string | null
  /** The promise an update is about. */
  target: number | null
  /** The target was found by wording, not by id: shown as "check". */
  check: boolean
  /** The title of a task to make, if the row makes one. */
  title: string | null
  due: LocalDate | null
  /** Can be added as it is (otherwise the row starts unticked and says what is missing). */
  ready: boolean
  item: ImportItem
}

export interface ImportMatch {
  rows: ImportRow[]
  /** Open promises of theirs, by people in the import, that no update is about. */
  notMentioned: number[]
}

const NO_PERSON: PersonMatch = { id: null, match: 'none' }
const isMe = (name: string | null | undefined) => !!name && /^(me|i|myself)$/i.test(name.trim())

/** Lower-case words of two or more letters or digits. */
export function importTokens(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2)
}

/** The share of `about`'s words that are in `title` (0 to 1). */
export function tokenOverlap(about: string, title: string): number {
  const wanted = [...new Set(importTokens(about))]
  if (!wanted.length) return 0
  const have = new Set(importTokens(title))
  return wanted.filter((token) => have.has(token)).length / wanted.length
}

export const IMPORT_OVERLAP_MIN = 0.6

/** Matches every item: people, initiatives, update targets; and the open promises not mentioned. */
export function matchImport(read: ReadImport, world: ImportWorld): ImportMatch {
  const initiative = (name: string | null | undefined) => {
    if (!name) return { id: null, name: null }
    const wanted = name.trim().toLowerCase()
    const found = world.initiatives.filter((entry) => entry.title.trim().toLowerCase() === wanted)
    return found.length === 1 ? { id: found[0].id, name: null } : { id: null, name: name.trim() }
  }
  const person = (name: string | null | undefined): PersonMatch => (name && !isMe(name) ? matchPerson(name, world.people) : NO_PERSON)
  const targeted = new Set<number>()
  const people = new Set<number>()
  const rows: ImportRow[] = read.items.map((item) => {
    const init = initiative(item.initiative)
    const base = { index: item.index, type: item.type, initiative: init.id, initiativeName: init.name, target: null, check: false, item }
    switch (item.type) {
      case 'promise': {
        const match = person(item.owner)
        if (match.id !== null) people.add(match.id)
        const clearYes = !!item.in_their_words
        const name = item.owner ?? null
        return {
          ...base,
          action: clearYes ? 'their_promise' : 'confirm',
          name,
          person: match,
          title: clearYes ? item.what : confirmTitle(name ?? '?', item.what),
          due: item.due ?? null,
          ready: match.id !== null,
        }
      }
      case 'action': {
        const match = person(item.for)
        return {
          ...base,
          action: 'my_task',
          name: item.for ?? null,
          person: match,
          title: item.what,
          due: item.due ?? null,
          ready: !item.for || match.id !== null,
        }
      }
      case 'update': {
        const match = person(item.owner)
        if (match.id !== null) people.add(match.id)
        let target: number | null = null
        let check = false
        const id = item.id ? /^(?:t-)?(\d+)$/i.exec(item.id.trim()) : null
        if (id && world.openPromises.some((promise) => promise.taskId === Number(id[1]))) {
          target = Number(id[1])
        } else {
          const about = item.about ?? item.what
          let best = 0
          for (const promise of world.openPromises) {
            if (match.id === null || promise.person !== match.id) continue
            const score = tokenOverlap(about, promise.title)
            if (score >= IMPORT_OVERLAP_MIN && (score > best || (score === best && target !== null && promise.taskId < target))) {
              best = score
              target = promise.taskId
            }
          }
          check = target !== null
        }
        if (target !== null) {
          targeted.add(target)
          const owner = world.openPromises.find((promise) => promise.taskId === target)?.person
          if (owner !== undefined) people.add(owner)
        }
        return { ...base, action: 'verdict', name: item.owner ?? null, person: match, target, check, title: null, due: item.new_due ?? null, ready: target !== null && !!item.status }
      }
      case 'open_item': {
        const match = person(item.ask)
        return { ...base, action: 'open_item', name: item.ask ?? null, person: match, title: item.ask ? `Ask ${item.ask}: ${item.what}` : null, due: null, ready: !item.ask || match.id !== null }
      }
      case 'decision':
        return { ...base, action: 'decision', name: item.by ?? null, person: person(item.by), title: null, due: null, ready: true }
      case 'decision_needed':
        return { ...base, action: 'owed', name: item.from ?? null, person: person(item.from), title: null, due: null, ready: true }
      case 'value':
        return { ...base, action: 'value', name: null, person: NO_PERSON, title: null, due: null, ready: true }
    }
  })
  const notMentioned = world.openPromises
    .filter((promise) => promise.dir === 'theirs' && people.has(promise.person) && !targeted.has(promise.taskId))
    .map((promise) => promise.taskId)
    .sort((a, b) => a - b)
  return { rows, notMentioned }
}

// --- Export and the Copilot prompt ------------------------------------------------------------------

export interface ExportPromise {
  taskId: number
  owner: string
  what: string
  due: LocalDate | null
  initiative: string | null
}

/** Decision 33: the open promises as `vicu-import/1` with ids, for Copilot to update. */
export function exportOpen(title: string, date: LocalDate, promises: readonly ExportPromise[]): string {
  const items = [...promises]
    .sort((a, b) => a.taskId - b.taskId)
    .map((promise) => {
      const item: Record<string, unknown> = { type: 'promise', id: `t-${promise.taskId}`, owner: promise.owner, what: promise.what }
      if (promise.due) item.due = promise.due
      if (promise.initiative) item.initiative = promise.initiative
      return item
    })
  return JSON.stringify({ format: IMPORT_FORMAT, source: { kind: 'export', title, date }, items }, null, 2)
}

export interface CopilotPromptTemplate {
  /** Lines; an array is an optional block, left out when one of its placeholders is empty. */
  lines: Array<string | string[]>
  /** The words for `{from_this}` per source kind. */
  kinds: Record<string, string>
}

export interface CopilotPromptInput {
  kind: string
  date: LocalDate
  me: string
  people: readonly string[]
  initiatives: readonly string[]
  open: readonly ExportPromise[]
}

/**
 * The prompt for Copilot (the fixture's `pro.copilotPrompt` in ai-tools-v1.json): placeholders
 * `{from_this}`, `{kind}`, `{me}`, `{people}`, `{initiatives}`, `{date}`, `{open}` (the open
 * promises as one line of JSON with their ids).
 */
export function copilotPrompt(template: CopilotPromptTemplate, input: CopilotPromptInput): string {
  const open = input.open.length
    ? JSON.stringify([...input.open].sort((a, b) => a.taskId - b.taskId).map((promise) => {
      const item: Record<string, unknown> = { id: `t-${promise.taskId}`, owner: promise.owner, what: promise.what }
      if (promise.due) item.due = promise.due
      return item
    }))
    : ''
  const values: Record<string, string> = {
    from_this: template.kinds[input.kind] ?? template.kinds.meeting,
    kind: template.kinds[input.kind] ? input.kind : 'meeting',
    me: input.me,
    people: input.people.join(', '),
    initiatives: input.initiatives.join(', '),
    date: input.date,
    open,
  }
  const fill = (line: string) => line.replace(/\{([a-z_]+)\}/g, (_, key: string) => values[key] ?? '')
  const lines: string[] = []
  for (const entry of template.lines) {
    if (typeof entry === 'string') {
      lines.push(fill(entry))
      continue
    }
    const empty = entry.some((line) => [...line.matchAll(/\{([a-z_]+)\}/g)].some((match) => !values[match[1]]))
    if (!empty) lines.push(...entry.map(fill))
  }
  return lines.join('\n')
}
