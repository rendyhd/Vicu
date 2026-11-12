/**
 * Pro's assistant requests (docs/ai-assistant-v1.md sections 11.1 and 11.2): the user messages and
 * the checks on the answers. Converting pasted text gives a `vicu-import/1` document that goes
 * through the same reading, matching and review as a pasted one; promise drafts are checked like
 * dictation drafts. Pure: the date reading is passed in.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { PRO_AI } from './contract'
import { IMPORT_FORMAT } from '../pro/import'
import type { LocalDate } from '../due-dates'

const tag = (name: string, body: string) => `<${name}>\n${body}\n</${name}>`

export interface ProImportRequest {
  me: string
  people: readonly string[]
  initiatives: readonly string[]
  /** Open promises: `t-<taskId>` ids for updates. */
  open: ReadonlyArray<{ taskId: number; title: string; person: string; dir: string }>
  text: string
}

/** The user message of a conversion (11.1). */
export function proImportUser(request: ProImportRequest): string {
  return [
    tag('me', request.me),
    tag('people', request.people.join('\n') || '(none)'),
    tag('initiatives', request.initiatives.join('\n') || '(none)'),
    tag('open', request.open.map((entry) => `t-${entry.taskId}: ${entry.title} (${entry.person}, ${entry.dir === 'mine' ? 'you owe it' : 'they owe it'})`).join('\n') || '(none)'),
    tag('text', request.text),
  ].join('\n\n')
}

/**
 * The answer as a `vicu-import/1` document: null fields dropped, at most `import_items_max` items,
 * the source the person chose. Null when the answer has no items.
 */
export function proImportDocument(answer: unknown, source: { kind: string; title: string; date: LocalDate | null }): string | null {
  const items = answer && typeof answer === 'object' && Array.isArray((answer as { items?: unknown }).items) ? (answer as { items: unknown[] }).items : []
  const kept = items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, PRO_AI.limits.import_items_max)
    .map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))))
  if (kept.length === 0) return null
  return JSON.stringify({ format: IMPORT_FORMAT, source: { kind: source.kind, title: source.title, ...(source.date ? { date: source.date } : {}) }, items: kept }, null, 2)
}

// --- Promise drafts (11.2) ------------------------------------------------------------------------

export interface PromiseDraftsRequest {
  person: string
  me: string
  /** Your open promises to that person (titles). */
  mine: readonly string[]
  transcript: string
}

export function promiseDraftsUser(request: PromiseDraftsRequest): string {
  return [
    tag('person', request.person),
    tag('me', request.me),
    tag('mine', request.mine.join('\n') || '(none)'),
    tag('transcript', request.transcript),
  ].join('\n\n')
}

export interface PromiseDraft {
  what: string
  mine: boolean
  due: LocalDate | null
  due_said: string | null
  words: string | null
  done_when: string | null
  needs: string[]
}

const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * The checks of 11.2: `due_said` read by the quick-add date rules (dates only; not read, no date),
 * `words` that do not appear in the transcript dropped, `needs` kept only when they name one of
 * your promises, empty `what` left out, at most `promise_drafts_max`.
 */
export function checkPromiseDrafts(answer: unknown, request: PromiseDraftsRequest, readDate: (said: string) => LocalDate | null): PromiseDraft[] {
  const raw = answer && typeof answer === 'object' && Array.isArray((answer as { promises?: unknown }).promises) ? (answer as { promises: unknown[] }).promises : []
  const transcript = squash(request.transcript)
  const mine = new Map(request.mine.map((title) => [squash(title), title]))
  const drafts: PromiseDraft[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const value = entry as Record<string, unknown>
    const what = typeof value.what === 'string' ? value.what.trim() : ''
    if (!what) continue
    const said = typeof value.due_said === 'string' && value.due_said.trim() ? value.due_said.trim() : null
    const words = typeof value.words === 'string' && value.words.trim() && transcript.includes(squash(value.words)) ? value.words.trim() : null
    const needs = Array.isArray(value.needs)
      ? value.needs.flatMap((need) => (typeof need === 'string' && mine.has(squash(need)) ? [mine.get(squash(need))!] : []))
      : []
    drafts.push({
      what,
      mine: value.mine === true,
      due_said: said,
      due: said ? readDate(said) : null,
      words,
      done_when: typeof value.done_when === 'string' && value.done_when.trim() ? value.done_when.trim() : null,
      needs,
    })
    if (drafts.length >= PRO_AI.limits.promise_drafts_max) break
  }
  return drafts
}
