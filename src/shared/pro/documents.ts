/**
 * Text for other people (docs/cross-app-semantics-v1.md section 21.19): a session's agenda,
 * read-back and recap, the check message and the weekly note, as documents made of lines. A line is
 * a catalog key with parameters, so the text can be written in any language; names and titles are
 * never translated. Rendering gives plain text, HTML and Markdown. Both apps run the
 * `pro.documents` vectors, which also fix the English text of every key.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, localDateOf, type LocalDate } from '../due-dates'
import { finalVerdictOf, recordValue, type LedgerSettingsValue, type LogValue, type PromiseValue, type ProLedger, type Verdict } from './ledger'
import { actionDue, actionsOf, groupLog, openIssues, ownerOf, ownerRank, verdictsBetween, YOU, type Group, type GroupTask } from './groups'
import { effectiveDue, requesterOf } from './promises'
import { sessionActions, sessionContents, sessionKindOf, type SessionKind } from './sessions'
import type { WeekStart } from '../week-start'

/** A day parameter: written as the weekday date in the text's language when the line is rendered. */
export interface DocDay {
  day: LocalDate
}

export type DocParam = string | number | DocDay

export interface DocLine {
  key: string
  params?: Record<string, DocParam>
}

export interface DocBlock {
  heading?: DocLine
  /** A paragraph, before the items. */
  text?: DocLine
  items?: DocLine[]
}

export interface ProDocument {
  title?: DocLine
  blocks: DocBlock[]
}

export const LITERAL_KEY = 'literal'

const line = (key: string, params?: Record<string, DocParam>): DocLine => (params ? { key, params } : { key })
const literal = (text: string): DocLine => ({ key: LITERAL_KEY, params: { text } })

// --- Rendering ----------------------------------------------------------------------------------

/** The catalog: a key and its parameters (days already written out, `count` kept a number). */
export type DocTranslate = (key: string, params: Record<string, string | number>) => string

export interface RenderedDocument {
  text: string
  html: string
  markdown: string
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One line as text: `literal` is its `text`; days go through `formatDay` first. */
export function renderLine(entry: DocLine, t: DocTranslate, formatDay: (day: LocalDate) => string): string {
  const params: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(entry.params ?? {})) {
    params[name] = typeof value === 'object' && value !== null ? formatDay(value.day) : value
  }
  if (entry.key === LITERAL_KEY) return String(params.text ?? '')
  return t(entry.key, params)
}

/**
 * The three forms of a document. Plain text: the title, an empty line, then each block (heading,
 * paragraph, items as "- " lines) with an empty line between blocks. HTML: the title and headings
 * as bold paragraphs, items as a list. Markdown: `## ` title, `### ` headings, `- ` items.
 */
export function renderDocument(doc: ProDocument, t: DocTranslate, formatDay: (day: LocalDate) => string): RenderedDocument {
  const write = (entry: DocLine) => renderLine(entry, t, formatDay)
  const text: string[] = []
  const html: string[] = []
  const markdown: string[] = []
  if (doc.title) {
    const title = write(doc.title)
    text.push(title)
    html.push(`<p><strong>${escapeHtml(title)}</strong></p>`)
    markdown.push(`## ${title}`)
  }
  for (const block of doc.blocks) {
    const lines: string[] = []
    const md: string[] = []
    if (block.heading) {
      const heading = write(block.heading)
      lines.push(heading)
      html.push(`<p><strong>${escapeHtml(heading)}</strong></p>`)
      md.push(`### ${heading}`, '')
    }
    if (block.text) {
      const paragraph = write(block.text)
      lines.push(paragraph)
      html.push(`<p>${escapeHtml(paragraph)}</p>`)
      md.push(paragraph)
      if (block.items?.length) md.push('')
    }
    if (block.items?.length) {
      html.push('<ul>')
      for (const item of block.items) {
        const written = write(item)
        lines.push(`- ${written}`)
        html.push(`<li>${escapeHtml(written)}</li>`)
        md.push(`- ${written}`)
      }
      html.push('</ul>')
    }
    if (!lines.length) continue
    if (text.length) text.push('')
    text.push(...lines)
    if (markdown.length) markdown.push('')
    markdown.push(...md)
  }
  return { text: text.join('\n'), html: html.join(''), markdown: markdown.join('\n') }
}

/**
 * A catalog as a flat table (`"note.onTime_one": "…"`): `{{name}}` placeholders, and with a `count`
 * the `_one` form for 1 and `_other` otherwise. English and the vectors use it; an app's own
 * catalog (i18next, string resources) must give the same English.
 */
export function messageFormatter(messages: Readonly<Record<string, string>>): DocTranslate {
  return (key, params) => {
    const count = params.count
    const template = (typeof count === 'number' ? messages[`${key}_${count === 1 ? 'one' : 'other'}`] : undefined) ?? messages[key]
    if (template === undefined) return key
    return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, name: string) => (name in params ? String(params[name]) : ''))
  }
}

/** The language a group's text is written in: its own, else the setting, else English. */
export function textLanguage(group: Pick<Group, 'language'> | null | undefined, settings: LedgerSettingsValue | null | undefined): string {
  const own = group?.language
  if (own) return own
  const general = settings?.text_language
  return typeof general === 'string' && general.trim() ? general.trim() : 'en'
}

// --- Lines --------------------------------------------------------------------------------------

export interface DocNames {
  /** A person's name by label id. */
  person: (id: number) => string
  /** Your own name. */
  me: string
}

const ownerName = (promise: PromiseValue | null | undefined, names: DocNames): string | null => {
  const owner = ownerOf(promise)
  return owner === null ? null : owner === YOU ? names.me : names.person(owner)
}

/** A person or anyone named in words; a group or you is not written out. */
const requesterName = (promise: PromiseValue | null | undefined, names: DocNames): string | null => {
  const requester = requesterOf(promise)
  if (requester.kind === 'person') return names.person(requester.person)
  if (requester.kind === 'text') return requester.text
  return null
}

const titleOf = (task: { title?: string }): string => (task.title ?? '').trim()

/** An open action: owner, who it is for when that is a person, title and date. */
export function actionLine(task: GroupTask, promise: PromiseValue | null | undefined, names: DocNames): DocLine {
  const owner = ownerName(promise, names)
  const requester = requesterName(promise, names)
  const due = actionDue(task, promise)
  const title = titleOf(task)
  if (owner === null) return due ? line('action.noOwner', { title, date: { day: due } }) : line('action.noOwnerNoDate', { title })
  if (requester !== null) {
    return due ? line('action.forPerson', { owner, requester, title, date: { day: due } }) : line('action.forPersonNoDate', { owner, requester, title })
  }
  return due ? line('action.owner', { owner, title, date: { day: due } }) : line('action.ownerNoDate', { owner, title })
}

/** An action after a verdict: delivered, late, dropped, done by you, a new date or not yet. */
export function verdictLine(task: GroupTask, promise: PromiseValue | null | undefined, verdict: Verdict, names: DocNames): DocLine {
  const owner = ownerName(promise, names) ?? names.me
  const title = titleOf(task)
  const blocker = typeof verdict.blocker === 'string' && verdict.blocker.trim() ? verdict.blocker.trim() : null
  switch (verdict.kind) {
    case 'delivered':
      return line('action.delivered', { owner, title })
    case 'late':
      return line('action.deliveredLate', { owner, title })
    case 'dropped':
      return line('action.dropped', { owner, title })
    case 'taken_over':
      return line('action.takenOver', { owner, title, me: names.me })
    default: {
      const newDue = typeof verdict.new_due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(verdict.new_due) ? verdict.new_due : null
      if (newDue) {
        return blocker
          ? line('action.newDateBlocker', { owner, title, date: { day: newDue }, blocker })
          : line('action.newDate', { owner, title, date: { day: newDue } })
      }
      return blocker ? line('action.notYetBlocker', { owner, title, blocker }) : line('action.notYet', { owner, title })
    }
  }
}

function decisionLine(value: LogValue, names: DocNames): DocLine {
  const text = value.text.trim()
  return typeof value.by === 'number' && value.by > 0 ? line('decision.by', { text, by: names.person(value.by) }) : line('decision.plain', { text })
}

const block = (heading: string, items: DocLine[]): DocBlock[] => (items.length ? [{ heading: line(heading), items }] : [])

// --- A session's documents ----------------------------------------------------------------------

export interface SessionDocInput {
  group: Group
  kind: string
  /** The local day of the session. */
  date: LocalDate
  /** Tasks with the group's label, open and done. */
  tasks: readonly GroupTask[]
  ledger: ProLedger | null | undefined
  names: DocNames
}

const titleKey = (prefix: string, kind: string): string => `${prefix}.title.${sessionKindOf(kind) satisfies SessionKind}`

/** The agenda: actions due, other open actions, open issues (weekly), the closing line. */
export function agendaDocument(input: SessionDocInput & { today: LocalDate; weekStart: WeekStart }): ProDocument {
  const { group, ledger, names } = input
  const kind = sessionKindOf(input.kind)
  const byId = new Map(input.tasks.map((task) => [task.id, task]))
  const actions = sessionActions({ group, tasks: input.tasks, ledger, today: input.today, kind, weekStart: input.weekStart })
  const lines = (ids: readonly number[]) => ids.map((id) => actionLine(byId.get(id) as GroupTask, recordValue(ledger?.promises, id), names))
  const blocks: DocBlock[] = [
    ...block('heading.actionsDue', lines(actions.verdicts)),
    ...block('heading.actionsOpen', lines(actions.others)),
  ]
  if (kind === 'weekly') blocks.push(...block('heading.issues', openIssues(ledger, group.label).map((entry) => literal(entry.value.text.trim()))))
  blocks.push({ text: line('agenda.close') })
  return { title: line(titleKey('agenda', kind), { group: group.name, date: { day: input.date } }), blocks }
}

export interface SessionRecapInput extends SessionDocInput {
  round: string
  started: string
  ended: string
  absent?: readonly number[]
}

function sessionParts(input: SessionRecapInput) {
  const { group, ledger, names } = input
  const byId = new Map(input.tasks.map((task) => [task.id, task]))
  const contents = sessionContents({ round: input.round, started: input.started, ended: input.ended, group, tasks: input.tasks, ledger })
  const log = (id: string) => recordValue(ledger?.log, id)
  const decisions = contents.decisions.flatMap((id) => {
    const value = log(id)
    return value ? [decisionLine(value, names)] : []
  })
  const created = contents.created.map((id) => actionLine(byId.get(id) as GroupTask, recordValue(ledger?.promises, id), names))
  return { contents, decisions, created, byId, log }
}

/** The read-back: the session's decisions and new actions, to read aloud. */
export function readBackDocument(input: SessionRecapInput): ProDocument {
  const parts = sessionParts(input)
  const blocks = [...block('heading.decisions', parts.decisions), ...block('heading.newActions', parts.created)]
  if (!blocks.length) blocks.push({ text: line('readback.nothing') })
  return { title: line('readback.title', { group: input.group.name, date: { day: input.date } }), blocks }
}

export interface SessionRecap {
  document: ProDocument
  /** The promises in it, to mark as sent. */
  taskIds: number[]
  /** The decisions in it, to mark as shared. */
  decisionIds: string[]
}

/**
 * The recap of one session: decisions, new actions, delivered, changed, issues solved, open issues,
 * open questions asked in it, and who was absent.
 */
export function recapDocument(input: SessionRecapInput): SessionRecap {
  const { group, ledger, names } = input
  const parts = sessionParts(input)
  const delivered: DocLine[] = []
  const changed: DocLine[] = []
  const inRecap = new Set<number>(parts.contents.created)
  for (const { taskId, verdict } of parts.contents.verdicts) {
    const task = parts.byId.get(taskId)
    if (!task) continue
    const written = verdictLine(task, recordValue(ledger?.promises, taskId), verdict, names)
    if (verdict.kind === 'delivered' || verdict.kind === 'late') delivered.push(written)
    else changed.push(written)
    inRecap.add(taskId)
  }
  const literals = (ids: readonly string[]) => ids.flatMap((id) => {
    const value = parts.log(id)
    return value ? [literal(value.text.trim())] : []
  })
  const blocks: DocBlock[] = [
    ...block('heading.decisions', parts.decisions),
    ...block('heading.newActions', parts.created),
    ...block('heading.delivered', delivered),
    ...block('heading.changed', changed),
    ...block('heading.issuesSolved', literals(parts.contents.solved)),
    ...block('heading.issues', openIssues(ledger, group.label).map((entry) => literal(entry.value.text.trim()))),
    ...block('heading.questions', literals(parts.contents.questions)),
  ]
  const absent = [...new Set(input.absent ?? [])].map((id) => names.person(id))
  if (absent.length) blocks.push({ text: line('absent', { names: absent.join(', ') }) })
  if (!blocks.length) blocks.push({ text: line('recap.nothing') })
  return {
    document: { title: line(titleKey('recap', input.kind), { group: group.name, date: { day: input.date } }), blocks },
    taskIds: [...inRecap].filter((id) => !!recordValue(ledger?.promises, id)).sort((a, b) => a - b),
    decisionIds: [...parts.contents.decisions],
  }
}

// --- The check message --------------------------------------------------------------------------

export interface CheckItem {
  title: string
  due: LocalDate | null
}

/** The first word of a name, for a greeting. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/** One message to one person: one thing as a sentence, more as a list. Null without items. */
export function checkDocument(name: string, items: readonly CheckItem[]): ProDocument | null {
  if (!items.length) return null
  const greeting = firstName(name)
  if (items.length === 1) {
    const [only] = items
    const title = only.title.trim()
    return {
      blocks: [{ text: only.due ? line('check.one', { name: greeting, title, date: { day: only.due } }) : line('check.oneNoDate', { name: greeting, title }) }],
    }
  }
  return {
    blocks: [
      {
        text: line('check.intro', { name: greeting, count: items.length }),
        items: items.map((item) => (item.due ? line('check.item', { title: item.title.trim(), date: { day: item.due } }) : line('check.itemNoDate', { title: item.title.trim() }))),
      },
      { text: line('check.close') },
    ],
  }
}

// --- The weekly note ----------------------------------------------------------------------------

export interface WeeklyNoteInput {
  /** The groups to cover, in order. */
  groups: readonly Group[]
  /** Tasks carrying a group's label: open ones, and done ones completed in the period. */
  tasks: readonly GroupTask[]
  ledger: ProLedger | null | undefined
  from: LocalDate
  to: LocalDate
  names: DocNames
}

/**
 * The weekly note (section 21.19): per group, counts of actions delivered on time, late, dropped
 * and done by you in the period, each date that slipped, decisions, open issues, actions open past
 * their date, and actions due in the 7 days after the period.
 */
export function weeklyNoteDocument(input: WeeklyNoteInput): ProDocument {
  const { ledger, names, from, to } = input
  const inPeriod = (day: LocalDate) => day >= from && day <= to
  const startInstant = (at: string) => inPeriod(localDateOf(at))
  const blocks: DocBlock[] = []
  for (const group of input.groups) {
    const counts = { onTime: 0, late: 0, dropped: 0, takenOver: 0, pastDue: 0, next: 0 }
    const slipped: Array<{ rank: [number, number]; due: LocalDate | null; id: number; line: DocLine }> = []
    for (const task of actionsOf(input.tasks, group.label)) {
      const promise = recordValue(ledger?.promises, task.id)
      const final = finalVerdictOf(promise)
      if (promise && promise.dir === 'theirs' && final && startInstant(final.at)) {
        if (final.kind === 'delivered') counts.onTime++
        else if (final.kind === 'late') counts.late++
        else if (final.kind === 'dropped') counts.dropped++
        else if (final.kind === 'taken_over') counts.takenOver++
      }
      if (task.done || final) continue
      const due = actionDue(task, promise)
      if (due !== null && due < to) counts.pastDue++
      if (due !== null && due > to && due <= addLocalDays(to, 7)) counts.next++
      if (!promise || promise.dir !== 'theirs') continue
      const misses = (promise.verdicts ?? []).filter((verdict) => verdict.undone !== true && verdict.kind === 'not_yet' && startInstant(verdict.at))
      const last = misses[misses.length - 1]
      if (!last) continue
      const written = verdictLine(task, promise, last, names)
      slipped.push({ rank: ownerRank(group, ownerOf(promise)), due: effectiveDue(task, promise), id: task.id, line: line(written.key.replace(/^action\./, 'note.slipped.'), written.params) })
    }
    slipped.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || (a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1))
    const items: DocLine[] = []
    if (counts.onTime) items.push(line('note.onTime', { count: counts.onTime }))
    if (counts.late) items.push(line('note.late', { count: counts.late }))
    if (counts.dropped) items.push(line('note.dropped', { count: counts.dropped }))
    if (counts.takenOver) items.push(line('note.takenOver', { count: counts.takenOver, me: names.me }))
    items.push(...slipped.map((entry) => entry.line))
    const decisions = groupLog(ledger, group.label, 'decision').filter((entry) => inPeriod(entry.value.at)).reverse()
    items.push(...decisions.map((entry) => line('note.decision', { text: entry.value.text.trim() })))
    items.push(...openIssues(ledger, group.label).map((entry) => line('note.issue', { text: entry.value.text.trim() })))
    if (counts.pastDue) items.push(line('note.pastDue', { count: counts.pastDue }))
    if (counts.next) items.push(line('note.nextWeek', { count: counts.next }))
    if (!items.length) items.push(line('note.nothing'))
    blocks.push({ heading: literal(group.name), items })
  }
  if (!blocks.length) blocks.push({ text: line('note.noGroups') })
  return { title: line('note.title', { from: { day: from }, to: { day: to } }), blocks }
}

/** Verdicts given on a promise in a time range (re-exported for the views that list them). */
export { verdictsBetween }
