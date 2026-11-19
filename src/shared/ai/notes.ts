/**
 * Notes to tasks (docs/ai-assistant-v1.md section 4.9): written notes (typed text, files, PDFs,
 * photos of pages) organized like a brain dump. Here: the pages read from images (the `notesRead`
 * request's message and answer), the batches a long transcript is cut into, the organize request's
 * context and user message, the checks after 4.8.3 (page, from, owner, decisions, questions), the
 * merge of the batches into one plan, who an item is for (owner, section 4.9.6) and the line each
 * added task's notes end with. Pinned by the `notes` block of test-fixtures/ai-tools-v1.json; Vicu
 * mobile implements the same rules.
 *
 * Pure: only imports its siblings, so every tsconfig can include it.
 */
import { AI_LIMITS } from './contract'
import {
  checkBrainDumpAnswer,
  planAsAnswer,
  type BrainDumpAnswer,
  type BrainDumpDraft,
  type BrainDumpTaskAnswer,
  type CheckedProject,
  type KnownProject,
} from './brain-dump'
import { compareLowercased, dictationContextJson, type CheckContext, type DictationContextInput, type DroppedField } from './dictation'
import { matchPerson, normalizeName, type Person } from '../pro/people'

// --- Pages and batches (4.9.2, 4.9.3) --------------------------------------------------------

/** One page of the transcript: its number (1, 2, ...) and its text. */
export interface NotesPage {
  n: number
  text: string
}

/** The text a page's `notesRead` answer gives: trimmed, a whole-answer code fence removed, line ends as `\n`. */
export function readPageAnswer(answer: string): string {
  let text = answer.replace(/\r\n?/g, '\n').trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text)
  if (fenced) text = fenced[1].trim()
  return text
}

/** The user message's text of a `notesRead` request, after the image (4.9.2). */
export function readPageUserText(page: number, pages: number, title: string): string {
  const name = title.trim()
  return name ? `<page>${page} of ${pages}</page>\n<title>${name}</title>` : `<page>${page} of ${pages}</page>`
}

/** Cuts a long page at the last line break at or before `max`, else the last space, else at `max`. */
function cutPage(text: string, max: number): [string, string] {
  const lineBreak = text.lastIndexOf('\n', max)
  if (lineBreak > 0) return [text.slice(0, lineBreak), text.slice(lineBreak + 1)]
  const space = text.lastIndexOf(' ', max)
  if (space > 0) return [text.slice(0, space), text.slice(space + 1)]
  return [text.slice(0, max), text.slice(max)]
}

/**
 * The batches of 4.9.3: the pages in order (empty ones left out), packed while a batch's text stays
 * at most `max` characters (UTF-16 units of the pages' texts); a page longer than `max` is cut into
 * parts that keep its number, each part on its own.
 */
export function notesBatches(pages: readonly NotesPage[], max: number = AI_LIMITS.notes_batch_chars): NotesPage[][] {
  const parts: NotesPage[] = []
  for (const page of pages) {
    let rest = page.text.replace(/\r\n?/g, '\n').trim()
    while (rest.length > max) {
      const [head, tail] = cutPage(rest, max)
      if (head.trim()) parts.push({ n: page.n, text: head.trim() })
      rest = tail.trim()
    }
    if (rest) parts.push({ n: page.n, text: rest })
  }
  const batches: NotesPage[][] = []
  let current: NotesPage[] = []
  let size = 0
  for (const part of parts) {
    if (current.length > 0 && size + part.text.length > max) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(part)
    size += part.text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// --- The request (4.9.4) ------------------------------------------------------------------------

export interface NotesContextInput extends DictationContextInput {
  /** The account's name, or null. */
  me: string | null
  /** Names the person knows: members of shared projects, and Pro people while Pro's assistant is on. */
  people: readonly string[]
  /** The notes' title as typed, or empty. */
  title: string
}

/**
 * The context JSON of a notes request: the keys of 4.1 (with `now` at the notes' date), then `me`,
 * `people` (once each, ignoring case, ordered by lowercased name) and `notes_title`.
 */
export function notesContextJson(input: NotesContextInput): string {
  const base = JSON.parse(dictationContextJson(input)) as Record<string, unknown>
  const seen = new Set<string>()
  const people: string[] = []
  for (const raw of input.people) {
    const name = raw.trim().replace(/\s+/g, ' ')
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    people.push(name)
  }
  people.sort(compareLowercased)
  return JSON.stringify({ ...base, me: input.me?.trim() || null, people, notes_title: input.title.trim() })
}

/** A page's text inside `<notes>`: its closing tags defused. */
function pageBlock(page: NotesPage): string {
  const text = page.text.split('</page>').join('</ page>').split('</notes>').join('</ notes>')
  return `<page n="${page.n}">\n${text}\n</page>`
}

/** A notes task in the answer's own shape (4.9.5): the brain dump task with `owner`, `page` and `from` after `project_ref`. */
export type NotesTaskAnswer = BrainDumpTaskAnswer & {
  owner: string | null
  page: number | null
  from: string | null
}

/** The `<plan>` block of an Update of notes (4.9.8). */
export interface NotesPlanBlock {
  projects: BrainDumpAnswer['projects']
  tasks: NotesTaskAnswer[]
}

/**
 * The one user message of a notes request (4.9.4): context, then the new projects of earlier
 * batches, then (an Update) the plan, then the notes page by page, then (an Update) the words.
 */
export function notesUserMessage(
  contextJson: string,
  pages: readonly NotesPage[],
  options: { soFar?: readonly KnownProject[]; plan?: NotesPlanBlock; words?: string } = {},
): string {
  const parts = [`<context>\n${contextJson}\n</context>`]
  if (options.soFar && options.soFar.length > 0) {
    parts.push(`<projects_so_far>\n${JSON.stringify(options.soFar.map((p) => ({ ref: p.ref, title: p.title, path: p.path })))}\n</projects_so_far>`)
  }
  if (options.plan) parts.push(`<plan>\n${JSON.stringify(options.plan)}\n</plan>`)
  parts.push(`<notes>\n${pages.map(pageBlock).join('\n')}\n</notes>`)
  if (options.words !== undefined) parts.push(`<transcript>\n${options.words.split('</transcript>').join('</ transcript>')}\n</transcript>`)
  return parts.join('\n')
}

// --- The answer and its checks (4.9.5, 4.9.6) -----------------------------------------------------

export interface NotesDecisionAnswer {
  what: string
  by: string | null
  page: number | null
}

export interface NotesQuestionAnswer {
  what: string
  ask: string | null
  page: number | null
}

export interface NotesAnswer {
  projects: BrainDumpAnswer['projects']
  tasks: NotesTaskAnswer[]
  decisions: NotesDecisionAnswer[]
  questions: NotesQuestionAnswer[]
  unclear: string[]
}

/** A checked notes draft: the brain dump draft with `owner`, `page` and `from` at the end. */
export interface NotesDraft extends BrainDumpDraft {
  /** `me`, the name as written, or null. */
  owner: string | null
  page: number | null
  from: string | null
}

export interface NotesResult {
  projects: CheckedProject[]
  drafts: NotesDraft[]
  decisions: NotesDecisionAnswer[]
  questions: NotesQuestionAnswer[]
  dropped: DroppedField[]
  unclear: string[]
}

export interface NotesCheckInput {
  /** The batch's pages. */
  pages: readonly NotesPage[]
  /** The account's name, or null. */
  me: string | null
  /** The new projects of earlier batches (4.9.3). */
  known?: readonly KnownProject[]
  /** The plan's projects so far + 1. */
  firstProjectNumber?: number
  /** The plan's drafts so far + 1. */
  firstDraftNumber?: number
}

const lineBreaks = /[\r\n]+/g

/** Lower case, inner whitespace as one space, trimmed: how `from` is found in a page (4.9.6). */
export function lineKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const space = text.lastIndexOf(' ', max)
  return space > 0 ? text.slice(0, space) : text.slice(0, max)
}

/** A name as given: line breaks and runs of spaces as one space, trimmed, at most `notes_owner_max_chars`; empty is null. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = cut(value.replace(/\s+/g, ' ').trim(), AI_LIMITS.notes_owner_max_chars)
  return name === '' ? null : name
}

/** The initials of a name of two words or more (`Rendy Jansen` is `rj`), else null. */
function initialsOf(name: string): string | null {
  const words = normalizeName(name).split(' ').filter(Boolean)
  return words.length >= 2 ? words.map((word) => word[0]).join('') : null
}

/**
 * The owner of 4.9.6 step 3: `me` for `me` or `I` (any case), for the account's name by the person
 * match of semantics 21.5 (title or unique first name), and for its initials (dots and spaces
 * ignored); otherwise the name as given; null for none.
 */
export function ownerOf(value: unknown, me: string | null): string | null {
  const name = cleanName(value)
  if (name === null) return null
  const key = normalizeName(name)
  if (key === 'me' || key === 'i') return 'me'
  const own = me?.trim()
  if (own) {
    const match = matchPerson(name, [{ id: 0, title: own }])
    if (match.match === 'title' || match.match === 'first') return 'me'
    const initials = initialsOf(own)
    if (initials && key.replace(/[.\s]/g, '') === initials) return 'me'
  }
  return name
}

/** The page a line is on (4.9.6 steps 1 and 2): `page` when it is one of the batch's, and `from` when found there. */
function placeLine(
  page: unknown,
  from: unknown,
  pages: readonly NotesPage[],
): { page: number | null; from: string | null; droppedPage: boolean; droppedFrom: boolean } {
  const numbers = new Set(pages.map((p) => p.n))
  const pageOk = typeof page === 'number' && Number.isInteger(page) && numbers.has(page)
  let at: number | null = pageOk ? page as number : null
  const droppedPage = page !== null && page !== undefined && !pageOk
  const line = typeof from === 'string' ? cut(from.replace(lineBreaks, ' ').replace(/\s+/g, ' ').trim(), AI_LIMITS.notes_from_max_chars) : ''
  if (line === '') return { page: at, from: null, droppedPage, droppedFrom: typeof from === 'string' && from.trim() !== '' }
  const key = lineKey(line)
  const contains = (n: number) => pages.some((p) => p.n === n && lineKey(p.text).includes(key))
  if (at !== null) return contains(at) ? { page: at, from: line, droppedPage, droppedFrom: false } : { page: at, from: null, droppedPage, droppedFrom: true }
  const found = pages.find((p) => lineKey(p.text).includes(key))
  if (!found) return { page: null, from: null, droppedPage, droppedFrom: true }
  at = found.n
  return { page: at, from: line, droppedPage, droppedFrom: false }
}

/**
 * The checks of 4.9.6 on one batch's answer: 4.8.3 (with the projects of earlier batches, every
 * kept project numbered from `firstProjectNumber`), then for each draft `page`, `from` and `owner`,
 * the drafts numbered from `firstDraftNumber`, then the decisions and questions.
 */
export function checkNotesAnswer(answer: NotesAnswer, ctx: CheckContext, input: NotesCheckInput): NotesResult {
  const extras: Array<{ page: number | null; from: string | null; owner: string | null; droppedPage: unknown; droppedFrom: unknown }> = []
  const result = checkBrainDumpAnswer(answer as unknown as BrainDumpAnswer, ctx, {
    known: input.known ?? [],
    firstProjectNumber: input.firstProjectNumber ?? 1,
    extendDraft: (task) => {
      const placed = placeLine(task.page, task.from, input.pages)
      extras.push({
        page: placed.page,
        from: placed.from,
        owner: ownerOf(task.owner, input.me),
        droppedPage: placed.droppedPage ? task.page : undefined,
        droppedFrom: placed.droppedFrom ? task.from : undefined,
      })
      return {}
    },
  })
  const first = input.firstDraftNumber ?? 1
  const refs = new Map<string, string>()
  const dropped: DroppedField[] = []
  const drafts = result.drafts.map((draft, index): NotesDraft => {
    const ref = `d${first + index}`
    refs.set(draft.ref, ref)
    const extra = extras[index]
    if (extra.droppedPage !== undefined) dropped.push({ ref, field: 'page', value: extra.droppedPage })
    if (extra.droppedFrom !== undefined) dropped.push({ ref, field: 'from', value: extra.droppedFrom })
    return { ...draft, ref, owner: extra.owner, page: extra.page, from: extra.from }
  })
  const decisions: NotesDecisionAnswer[] = []
  for (const raw of Array.isArray(answer.decisions) ? answer.decisions : []) {
    const what = typeof raw?.what === 'string' ? cut(raw.what.replace(lineBreaks, ' ').trim(), AI_LIMITS.title_max_chars) : ''
    if (!what || decisions.length >= AI_LIMITS.brain_dump_tasks_max) continue
    decisions.push({ what, by: cleanName(raw.by), page: placeLine(raw.page, null, input.pages).page })
  }
  const questions: NotesQuestionAnswer[] = []
  for (const raw of Array.isArray(answer.questions) ? answer.questions : []) {
    const what = typeof raw?.what === 'string' ? cut(raw.what.replace(lineBreaks, ' ').trim(), AI_LIMITS.title_max_chars) : ''
    if (!what || questions.length >= AI_LIMITS.brain_dump_tasks_max) continue
    questions.push({ what, ask: cleanName(raw.ask), page: placeLine(raw.page, null, input.pages).page })
  }
  // A kept draft's entries take its new ref; the entries of a draft the checks left out (`task`,
  // `title`) have the ref '', so they never land on another card numbered the same.
  const renamed = result.dropped.map((entry) => {
    if (entry.field === 'task' || entry.field === 'title') return { ...entry, ref: '' }
    return refs.has(entry.ref) ? { ...entry, ref: refs.get(entry.ref)! } : entry
  })
  return {
    projects: result.projects,
    drafts,
    decisions,
    questions,
    dropped: [...renamed, ...dropped],
    unclear: result.unclear,
  }
}

// --- The plan of all batches (4.9.3, 4.9.7) -------------------------------------------------------

export interface NotesPlan {
  projects: CheckedProject[]
  drafts: NotesDraft[]
  decisions: NotesDecisionAnswer[]
  questions: NotesQuestionAnswer[]
  dropped: DroppedField[]
  unclear: string[]
}

export const EMPTY_NOTES_PLAN: NotesPlan = { projects: [], drafts: [], decisions: [], questions: [], dropped: [], unclear: [] }

/** The known projects of the next batch's `<projects_so_far>`: the plan's new projects with their paths. */
export function knownProjects(plan: Pick<NotesPlan, 'projects'>, contextPath: (id: number) => string): KnownProject[] {
  const byRef = new Map(plan.projects.map((p) => [p.ref, p]))
  const pathOf = (project: CheckedProject, seen = new Set<string>()): string => {
    if (seen.has(project.ref)) return project.title
    seen.add(project.ref)
    if (project.parent_id !== null) {
      const top = contextPath(project.parent_id)
      return top ? `${top} / ${project.title}` : project.title
    }
    const parent = project.parent_ref !== null ? byRef.get(project.parent_ref) : undefined
    return parent ? `${pathOf(parent, seen)} / ${project.title}` : project.title
  }
  return plan.projects.map((project) => ({ ref: project.ref, title: project.title, path: pathOf(project) }))
}

/**
 * A checked batch added to the plan (4.9.7): its projects and drafts after the plan's, a draft whose
 * title and owner (ignoring case and spacing) are already in the plan left out (`duplicate`), at
 * most `notes_tasks_max` drafts in all (`task`), the decisions and questions not seen before.
 */
export function mergeNotesBatch(plan: NotesPlan, batch: NotesResult): NotesPlan {
  const key = (draft: NotesDraft) => `${lineKey(draft.title)}\u0000${lineKey(draft.owner ?? '')}`
  const seen = new Set(plan.drafts.map(key))
  const drafts = [...plan.drafts]
  const dropped = [...plan.dropped, ...batch.dropped]
  for (const draft of batch.drafts) {
    // A draft left out is no card: its entry has the ref ''.
    if (seen.has(key(draft))) {
      dropped.push({ ref: '', field: 'duplicate', value: draft.title })
      continue
    }
    if (drafts.length >= AI_LIMITS.notes_tasks_max) {
      dropped.push({ ref: '', field: 'task', value: draft.title })
      continue
    }
    seen.add(key(draft))
    drafts.push(draft)
  }
  const sameNote = (a: { what: string }, b: { what: string }) => lineKey(a.what) === lineKey(b.what)
  return {
    projects: [...plan.projects, ...batch.projects],
    drafts,
    decisions: [...plan.decisions, ...batch.decisions.filter((d) => !plan.decisions.some((e) => sameNote(d, e)))],
    questions: [...plan.questions, ...batch.questions.filter((q) => !plan.questions.some((e) => sameNote(q, e)))],
    dropped,
    unclear: [...plan.unclear, ...batch.unclear],
  }
}

/** The plan of an Update (4.9.8): the brain dump plan block with `owner`, `page` and `from` after `project_ref`. */
export function notesPlanAsAnswer(
  projects: readonly CheckedProject[],
  drafts: readonly NotesDraft[],
  placeName: (placeId: string) => string | null,
): NotesPlanBlock {
  const block = planAsAnswer(projects, drafts, placeName)
  return {
    projects: block.projects,
    tasks: block.tasks.map((task, i): NotesTaskAnswer => {
      const { ref, title, notes, when, project_id, project_ref, ...rest } = task
      const draft = drafts[i]
      return { ref, title, notes, when, project_id, project_ref, owner: draft.owner, page: draft.page, from: draft.from, ...rest }
    }),
  }
}

/** Update is offered while the plan came from one batch and has at most `brain_dump_tasks_max` drafts (4.9.8). */
export function canUpdateNotes(batches: number, drafts: number): boolean {
  return batches === 1 && drafts <= AI_LIMITS.brain_dump_tasks_max
}

// --- Owners (4.9.9) -------------------------------------------------------------------------------

/** What a card does with its owner. */
export type OwnerAction =
  /** A task of mine. */
  | { kind: 'mine' }
  /** Assigned to a member of the task's shared project (a Vikunja user id). */
  | { kind: 'assign'; userId: number }
  /** Pro: a promise of theirs (a person label). */
  | { kind: 'promise'; personId: number }
  /** Pro: my task "Confirm with <name>: <title>" with the person's label (semantics 21.6). */
  | { kind: 'confirm'; personId: number }
  /** The name kept in the title: "Lalith: <title>". */
  | { kind: 'name' }

export interface OwnerWorld {
  /** Members of the task's project when someone else can see it: `id` the user id, `title` the name, `aliases` the username. */
  members: readonly Person[]
  /** Pro people while Pro's promises layer is on, else empty. */
  people: readonly Person[]
  /** The review's "Agreed in the meeting" switch: a Pro person's item is their promise, not a confirm task. */
  agreed: boolean
}

/**
 * The owner's default action (4.9.9): none or me is mine; a member of the task's shared project
 * (semantics 21.5 matching) is assigned; a Pro person is a confirm task, or their promise while
 * "Agreed in the meeting" is on; any other name stays in the title.
 */
export function defaultOwnerAction(owner: string | null, world: OwnerWorld): OwnerAction {
  if (owner === null || owner === 'me') return { kind: 'mine' }
  const member = matchPerson(owner, world.members)
  if (member.id !== null) return { kind: 'assign', userId: member.id }
  const person = matchPerson(owner, world.people)
  if (person.id !== null) return world.agreed ? { kind: 'promise', personId: person.id } : { kind: 'confirm', personId: person.id }
  return { kind: 'name' }
}

/** Which cards the plan's filter ticks (4.9.9): mine; mine and the people Vicu knows (the default); everything. */
export type NotesFilter = 'mine' | 'mine_and_waiting' | 'everything'

export function tickedBy(filter: NotesFilter, action: OwnerAction): boolean {
  if (filter === 'everything') return true
  if (filter === 'mine') return action.kind === 'mine'
  return action.kind !== 'name'
}

/** The title a task is added with: the name kept in it ("Lalith: send the budget"), at most `title_max_chars`. */
export function namedTitle(name: string, title: string): string {
  return cut(`${name}: ${title}`, AI_LIMITS.title_max_chars)
}

/** The line every added task's notes end with (4.9.10): "From Offsite Q4, page 3: <the line>". */
export function notesSourceLine(title: string, date: string, page: number | null, from: string | null): string {
  const name = title.trim() || `Notes ${date}`
  return `From ${name}${page !== null ? `, page ${page}` : ''}${from ? `: ${from}` : ''}`
}

/** A draft's notes with the source line after a blank line. */
export function notesWithSource(notes: string, line: string): string {
  return notes.trim() ? `${notes}\n\n${line}` : line
}

/**
 * The new projects Add creates (4.9.10): those that hold a ticked task, with their new parents,
 * in the plan's order. A new project left without a ticked task is not made.
 */
export function projectsInUse(projects: readonly CheckedProject[], drafts: ReadonlyArray<Pick<BrainDumpDraft, 'project_ref'>>): CheckedProject[] {
  const byRef = new Map(projects.map((p) => [p.ref, p]))
  const used = new Set<string>()
  for (const draft of drafts) {
    let ref = draft.project_ref
    while (ref !== null && !used.has(ref)) {
      const project = byRef.get(ref)
      if (!project) break
      used.add(ref)
      ref = project.parent_ref
    }
  }
  return projects.filter((p) => used.has(p.ref))
}
