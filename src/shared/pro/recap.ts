/**
 * The recap (docs/cross-app-semantics-v1.md section 21.8): what was delivered, agreed, changed and is
 * still open, per person, plus what you owe and who was not discussed. One copy holds both a plain
 * text and an HTML version (decision 13); copying it marks the promises in it as sent (decision 7).
 * Both apps run the `pro.recapText` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { formatWeekdayDate, type DateFormat } from '../date-display'
import { localDateOf, type LocalDate } from '../due-dates'
import { activeVerdicts, finalVerdictOf, recordValue, type ProLedger } from './ledger'
import { effectiveDue } from './promises'

export type RecapSection = 'delivered' | 'agreed' | 'changed' | 'open' | 'mine'

export const RECAP_SECTION_TITLES: Record<RecapSection, string> = {
  delivered: 'Delivered',
  agreed: 'Agreed',
  changed: 'Changed',
  open: 'Open',
  mine: 'I owe',
}

const SECTION_ORDER: RecapSection[] = ['delivered', 'agreed', 'changed', 'open', 'mine']

export interface RecapTask {
  id: number
  title: string
  done?: boolean
  due_date?: string | null
  /** When the task was created (UTC instant). */
  created?: string | null
}

export interface RecapScope {
  /** The local days the recap covers, both included (one day for a meeting). */
  from: LocalDate
  to: LocalDate
  /** The people in the recap, in the order they are shown. */
  people: readonly number[]
  includeMine: boolean
}

export interface RecapItem {
  section: RecapSection
  taskId: number
  person: number
  title: string
  /** The effective due day, or null. */
  due: LocalDate | null
  late?: boolean
  newDue?: LocalDate | null
  blocker?: string | null
  words?: string | null
}

const inRange = (day: LocalDate, scope: RecapScope) => day >= scope.from && day <= scope.to

/**
 * The items of a recap: for each person in scope, their `theirs` promises delivered in the range
 * (delivered or late), agreed in it (the task was created in it), changed in it (the last verdict,
 * not yet or renegotiated, was given in it) and the rest still open; with `includeMine`, your open
 * `mine` promises to them. A promise is in one section only, the first that applies.
 */
export function recapItems(scope: RecapScope, tasks: readonly RecapTask[], ledger: ProLedger | null | undefined): RecapItem[] {
  const items: RecapItem[] = []
  const people = new Set(scope.people)
  for (const task of tasks) {
    const promise = recordValue(ledger?.promises, task.id)
    if (!promise || promise.person === null || !people.has(promise.person)) continue
    const due = effectiveDue(task, promise)
    const base = { taskId: task.id, person: promise.person, title: task.title, due, words: promise.words ?? null }
    const final = finalVerdictOf(promise)
    if (promise.dir === 'mine') {
      if (scope.includeMine && !final && !task.done) items.push({ ...base, section: 'mine' })
      continue
    }
    if (promise.dir !== 'theirs') continue
    if (final) {
      if ((final.kind === 'delivered' || final.kind === 'late') && inRange(localDateOf(final.at), scope)) {
        items.push({ ...base, section: 'delivered', late: final.kind === 'late' })
      }
      continue
    }
    if (task.done) continue
    const verdicts = activeVerdicts(promise)
    const last = verdicts[verdicts.length - 1]
    if (task.created && inRange(localDateOf(task.created), scope) && !last) {
      items.push({ ...base, section: 'agreed' })
    } else if (last && (last.kind === 'not_yet' || last.kind === 'renegotiated') && inRange(localDateOf(last.at), scope)) {
      items.push({ ...base, section: 'changed', newDue: last.new_due ?? null, blocker: last.blocker ?? null })
    } else {
      items.push({ ...base, section: 'open' })
    }
  }
  const order = new Map(scope.people.map((person, index) => [person, index]))
  return items.sort((a, b) =>
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    (order.get(a.person) ?? 0) - (order.get(b.person) ?? 0) ||
    (a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1) ||
    a.taskId - b.taskId)
}

export interface RecapInput {
  title: string
  date: LocalDate
  items: readonly RecapItem[]
  personName: (personId: number) => string
  notDiscussed?: readonly string[]
  absent?: readonly string[]
  includeQuotes: boolean
  now: Date
  fmt: DateFormat
}

export interface Recap {
  text: string
  html: string
  /** The promises copied, to mark as sent. */
  taskIds: number[]
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dayDate = (day: LocalDate): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

function itemLine(item: RecapItem, input: RecapInput): string {
  const date = (day: LocalDate) => formatWeekdayDate(dayDate(day), input.now, input.fmt)
  let line = `${input.personName(item.person)}: ${item.title.trim()}`
  if (item.section === 'delivered') {
    if (item.late) line += ' (late)'
  } else if (item.section === 'changed') {
    line += item.newDue ? `, new date ${date(item.newDue)}` : ', not yet'
    if (item.blocker) line += ` (${item.blocker})`
  } else if (item.due) {
    line += `, by ${date(item.due)}`
  }
  return line
}

/**
 * The recap's two versions. Text: the title line, a blank line, then each section with items as
 * "- " lines (a quote on the next line, indented two spaces, when asked for), then "Not discussed:"
 * and "Absent:" lines. HTML: the same as paragraphs and lists, with the quotes in `<em>`.
 */
export function buildRecap(input: RecapInput): Recap {
  const heading = `${input.title.trim()}, ${formatWeekdayDate(dayDate(input.date), input.now, input.fmt)}`
  const text: string[] = [heading]
  const html: string[] = [`<p><strong>${escapeHtml(input.title.trim())}</strong>, ${escapeHtml(heading.slice(input.title.trim().length + 2))}</p>`]
  let first = true
  for (const section of SECTION_ORDER) {
    const items = input.items.filter((item) => item.section === section)
    if (!items.length) continue
    if (first) text.push('')
    first = false
    text.push(RECAP_SECTION_TITLES[section])
    html.push(`<p><strong>${RECAP_SECTION_TITLES[section]}</strong></p>`, '<ul>')
    for (const item of items) {
      const line = itemLine(item, input)
      const quote = input.includeQuotes && item.words && item.words.trim() ? item.words.trim() : null
      text.push(`- ${line}`)
      if (quote) text.push(`  "${quote}"`)
      html.push(`<li>${escapeHtml(line)}${quote ? `<br><em>"${escapeHtml(quote)}"</em>` : ''}</li>`)
    }
    html.push('</ul>')
  }
  const tail: Array<[string, readonly string[] | undefined]> = [
    ['Not discussed', input.notDiscussed],
    ['Absent', input.absent],
  ]
  for (const [label, names] of tail) {
    if (!names?.length) continue
    if (first) text.push('')
    first = false
    text.push(`${label}: ${names.join(', ')}`)
    html.push(`<p>${label}: ${escapeHtml(names.join(', '))}</p>`)
  }
  return {
    text: text.join('\n'),
    html: html.join(''),
    taskIds: [...new Set(input.items.map((item) => item.taskId))].sort((a, b) => a - b),
  }
}
