/**
 * Dictation (docs/ai-assistant-v1.md section 4): the request's context and user message (4.1), the
 * eleven checks every draft goes through (4.3; a brain dump's tasks too, 4.8.3, see brain-dump.ts),
 * and the drafts block of an edit by voice (4.4).
 * Pinned by `dictation.checks` in test-fixtures/ai-tools-v1.json; Vicu mobile implements the same
 * rules.
 *
 * Times are local wall-clock strings (`YYYY-MM-DDTHH:mm:ss`), as in the contract. The quick-add
 * parser that reads `when.said` lives in the renderer, so it is passed in (`readSaid`); this file
 * stays pure and import-light.
 */
import { addLocalDays, type LocalDate } from '../due-dates'
import { getWeekStart } from '../week-start'
import { AI_LIMITS, DICTATION_FIELDS, type DraftField } from './contract'
import type { BrainDumpDraft } from './brain-dump'

// --- The model's answer (4.2) ------------------------------------------------------------

export interface WhenAnswer {
  said: string | null
  date: string | null
  time: string | null
}

export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

export interface DraftAnswer {
  ref: string
  title: string
  notes: string
  when: WhenAnswer
  project_id: number | null
  labels: string[]
  priority: number | null
  repeat: { every: number; unit: RepeatUnit } | null
  reminder: { before_due_minutes: number | null; at: string | null } | null
  place: { name: string; trigger: string } | null
  subtasks: string[]
  unsure: string[]
}

export interface DictationAnswer {
  tasks: DraftAnswer[]
  unclear: string[]
}

/** The `<drafts>` block of an edit by voice: `{"tasks": [...]}` in the answer's task shape. */
export interface DraftsBlock {
  tasks: DraftAnswer[]
}

// --- Checked drafts (4.3) ----------------------------------------------------------------

export type CheckedReminder = { before_due_minutes: number } | { at: string }

export interface CheckedDraft {
  ref: string
  title: string
  notes: string
  /** Local `YYYY-MM-DDTHH:mm:ss`; a date-only due date is 23:59:59 (semantics 1.1). */
  due: string | null
  project_id: number
  /** `id` null: a new label, created before the task. */
  labels: Array<{ id: number | null; title: string }>
  priority: number | null
  repeat: { every: number; unit: RepeatUnit } | null
  reminder: CheckedReminder | null
  place: { place_id: string; trigger: 'arrive' | 'leave' } | null
  subtasks: string[]
  /** Fields Vicu filled in itself or the model was unsure of, in the order of `dictation.fields`. */
  guessed: DraftField[]
}

/** A checked draft of dictation or of a brain dump (whose `project_id` is null when `project_ref` is set). */
export type AnyCheckedDraft = CheckedDraft | BrainDumpDraft

function projectRefOf(draft: AnyCheckedDraft): string | null {
  return 'project_ref' in draft ? draft.project_ref : null
}

export interface DroppedField {
  ref: string
  /** A draft field, or `task` for a draft over the limit. */
  field: string
  value: unknown
}

export interface CheckResult {
  drafts: CheckedDraft[]
  dropped: DroppedField[]
  unclear: string[]
}

export interface ContextProject {
  id: number
  title: string
  /** The titles from the top, joined with ` / `. */
  path: string
}

export interface CheckContext {
  /** The reference time (when the recording ended), local `YYYY-MM-DDTHH:mm:ss` or `YYYY-MM-DDTHH:mm`. */
  reference: string
  /** The list's default due date (quick add in Today gives today), or null. */
  defaultDue: LocalDate | null
  projects: readonly ContextProject[]
  default_project_id: number
  labels: readonly { id: number; title: string }[]
  places: readonly { id: string; name: string }[]
  /**
   * The quick-add parser with only dates enabled, reading `said` at the reference time: the local
   * date and, when it read one, the time `HH:MM`. Null when it finds no date.
   */
  readSaid: (said: string) => { date: LocalDate; time: string | null } | null
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/
const MOMENT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/

/** A real calendar date `YYYY-MM-DD`. */
export function isRealDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false
  const match = DATE_RE.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (m < 1 || m > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= days
}

/** A real 24-hour time `HH:MM`. */
export function isRealTime(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = TIME_RE.exec(value)
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59
}

/** `YYYY-MM-DDTHH:mm` (seconds dropped) of a reference. */
function minuteOf(reference: string): string {
  return reference.slice(0, 16)
}

function addYears(date: LocalDate, years: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number)
  const year = y + years
  // 29 February plus whole years is 28 February when that year has none.
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

const lower = (text: string): string => text.toLowerCase()
const lineBreaks = /[\r\n]+/g

/** The same place name, ignoring case and curly apostrophes (semantics 5.3). */
function placeKey(name: string): string {
  return lower(name.trim().replace(/[’‘]/g, "'"))
}

/** Cuts a title over the limit at the last space at or before the limit (4.3 step 2). */
function splitLongTitle(title: string, max: number): { title: string; rest: string } {
  if (title.length <= max) return { title, rest: '' }
  const space = title.lastIndexOf(' ', max)
  if (space >= 0) return { title: title.slice(0, space), rest: title.slice(space + 1) }
  return { title: title.slice(0, max), rest: title.slice(max) }
}

/** At most `max` UTF-16 units, never splitting a surrogate pair. */
function takeUtf16(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end--
  return text.slice(0, end)
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function sortedFields(fields: Iterable<string>): DraftField[] {
  const set = new Set(fields)
  return DICTATION_FIELDS.filter((field) => set.has(field))
}

/**
 * Step 4 of the checks (4.3), also used for a due date in an Ask update proposal (5.4): the
 * parser's reading of `said` when it finds a date, otherwise the model's `date` and `time` (marked
 * guessed) when they are real and in range. `dropped` is the value to report when the words gave
 * no usable date (`said`, or the date).
 */
export function readWhen(
  when: WhenAnswer | null | undefined,
  reference: string,
  readSaidFn: CheckContext['readSaid'],
): { due: string | null; guessed: boolean; dropped?: unknown } {
  const referenceDay = reference.slice(0, 10)
  const referenceMinute = minuteOf(reference)
  const lastModelDay = addYears(referenceDay, AI_LIMITS.model_date_max_years)
  const value = when ?? { said: null, date: null, time: null }
  const said = typeof value.said === 'string' ? value.said : null
  const parsed = said !== null && said.trim() !== '' ? readSaidFn(said) : null
  if (parsed) return { due: `${parsed.date}T${parsed.time ? `${parsed.time}:00` : '23:59:59'}`, guessed: false }
  const date = value.date ?? null
  const time = value.time ?? null
  if (date === null && time === null) return said !== null ? { due: null, guessed: false, dropped: said } : { due: null, guessed: false }
  const dateOk = date === null || (isRealDate(date) && date >= referenceDay && date <= lastModelDay)
  const timeOk = time === null || isRealTime(time)
  if (!dateOk || !timeOk) return { due: null, guessed: false, dropped: said ?? date }
  if (date !== null) return { due: `${date}T${time !== null ? `${time}:00` : '23:59:59'}`, guessed: true }
  // A time without a date: the reference day if still ahead, else the next day (semantics 5.1).
  const day = `${referenceDay}T${time}` > referenceMinute ? referenceDay : addLocalDays(referenceDay, 1)
  return { due: `${day}T${time}:00`, guessed: true }
}

/** Runs the checks of section 4.3 on a model's answer. */
export function checkDictationAnswer(answer: DictationAnswer, ctx: CheckContext): CheckResult {
  const { drafts, dropped } = checkTasks(answer.tasks, ctx, { draftsMax: AI_LIMITS.drafts_max })
  // Without a project_ref resolver every draft has a project of the context.
  const checked = drafts.map(({ project_ref: _ref, ...draft }): CheckedDraft => ({ ...draft, project_id: draft.project_id ?? ctx.default_project_id }))
  return { drafts: checked, dropped, unclear: unclearNotes(answer.unclear) }
}

/** The model's `unclear` notes, strings only. */
export function unclearNotes(notes: unknown): string[] {
  return (Array.isArray(notes) ? notes : []).filter((note): note is string => typeof note === 'string')
}

/** Where a brain dump's `project_ref` leads (4.8.3 step 5): a kept new project, a project of the context, or nowhere. */
export type ProjectRefTarget = { ref: string } | { id: number } | null

/** How a brain dump's task checks differ from dictation's (4.8.3 step 5). */
export interface TaskCheckOptions {
  /** At most this many drafts: `drafts_max`, or a brain dump's `brain_dump_tasks_max`. */
  draftsMax: number
  /** A brain dump gives no task the list's default due date. */
  noDefaultDue?: boolean
  /** A brain dump: where a non-empty `project_ref` leads, decided before step 5. */
  projectRef?: (ref: string) => ProjectRefTarget
}

/**
 * The checks of 4.3 on the drafts of an answer. Each draft has `project_ref` after `project_id`:
 * null unless a brain dump's `project_ref` named a kept new project (then `project_id` is null).
 */
export function checkTasks(
  answerTasks: readonly DraftAnswer[] | unknown,
  ctx: CheckContext,
  options: TaskCheckOptions,
): { drafts: BrainDumpDraft[]; dropped: DroppedField[] } {
  const dropped: DroppedField[] = []
  const referenceMinute = minuteOf(ctx.reference)
  const all = (Array.isArray(answerTasks) ? answerTasks : []) as Array<DraftAnswer & { project_ref?: unknown }>

  // 1. Drafts: at most 25 (a brain dump: 60); refs renumbered by position when any is empty or repeated.
  const tasks = all.slice(0, options.draftsMax)
  for (const extra of all.slice(options.draftsMax)) {
    dropped.push({ ref: extra.ref, field: 'task', value: extra.title })
  }
  const seen = new Set<string>()
  let renumber = false
  for (const task of tasks) {
    const ref = typeof task.ref === 'string' ? task.ref : ''
    if (ref === '' || seen.has(ref)) renumber = true
    seen.add(ref)
  }
  const refs = tasks.map((task, i) => (renumber ? `d${i + 1}` : task.ref))

  const drafts: BrainDumpDraft[] = []
  tasks.forEach((task, index) => {
    const ref = refs[index]
    const guessed = new Set<string>()
    const drop = (field: string, value: unknown) => dropped.push({ ref, field, value })

    // 2. Title.
    const flatTitle = (task.title ?? '').replace(lineBreaks, ' ').trim()
    if (flatTitle === '') {
      drop('title', task.title)
      return
    }
    const { title, rest } = splitLongTitle(flatTitle, AI_LIMITS.title_max_chars)

    // 3. Notes (the rest of a long title first).
    const ownNotes = (task.notes ?? '').trim()
    let notes = rest ? (ownNotes ? `${rest}\n\n${ownNotes}` : rest) : ownNotes
    notes = takeUtf16(notes, AI_LIMITS.notes_max_chars)

    // 4. When.
    const reading = readWhen(task.when, ctx.reference, ctx.readSaid)
    let due = reading.due
    if (reading.guessed) guessed.add('when')
    if (reading.dropped !== undefined) drop('when', reading.dropped)
    if (due === null && ctx.defaultDue && !options.noDefaultDue) due = `${ctx.defaultDue}T23:59:59`

    // A brain dump's project_ref first (4.8.3): a kept new project, or the context project a new
    // one was merged into; any other ref leaves step 5 to decide, marked guessed. Empty is null.
    let projectRef: string | null = null
    let projectId: number | null = ctx.default_project_id
    let decided = false
    if (options.projectRef && task.project_ref !== null && task.project_ref !== undefined && task.project_ref !== '') {
      const target = typeof task.project_ref === 'string' ? options.projectRef(task.project_ref) : null
      if (target && 'ref' in target) {
        projectRef = target.ref
        projectId = null
        decided = true
      } else if (target) {
        projectId = target.id
        decided = true
      } else {
        guessed.add('project')
      }
    }

    // 5. Project.
    if (!decided && task.project_id !== null && task.project_id !== undefined) {
      if (ctx.projects.some((project) => project.id === task.project_id)) projectId = task.project_id
      else guessed.add('project')
    }

    // 6. Labels.
    const labels: CheckedDraft['labels'] = []
    for (const raw of Array.isArray(task.labels) ? task.labels : []) {
      if (typeof raw !== 'string') continue
      let name = raw.trim()
      if (/^[#@*+]/.test(name)) name = name.slice(1).trim()
      if (name === '') continue
      const existing = ctx.labels.find((label) => lower(label.title) === lower(name))
      const label = existing ? { id: existing.id, title: existing.title } : { id: null, title: name }
      if (labels.some((taken) => lower(taken.title) === lower(label.title))) continue
      if (labels.length >= AI_LIMITS.labels_max) break
      labels.push(label)
    }

    // 7. Priority.
    let priority: number | null = null
    if (task.priority !== null && task.priority !== undefined) {
      if (isWholeNumber(task.priority) && task.priority >= 1 && task.priority <= 4) priority = task.priority
      else drop('priority', task.priority)
    }

    // 8. Repeat.
    let repeat: CheckedDraft['repeat'] = null
    if (task.repeat !== null && task.repeat !== undefined) {
      const { every, unit } = task.repeat
      if (isWholeNumber(every) && every >= 1 && every <= AI_LIMITS.repeat_every_max && ['day', 'week', 'month', 'year'].includes(unit)) {
        repeat = { every, unit }
      } else {
        drop('repeat', task.repeat)
      }
    }

    // 9. Reminder.
    let reminder: CheckedReminder | null = null
    if (task.reminder !== null && task.reminder !== undefined) {
      const { before_due_minutes: before, at } = task.reminder
      if (before !== null && before !== undefined && (at === null || at === undefined)) {
        if (isWholeNumber(before) && before >= 0 && before <= AI_LIMITS.reminder_before_due_max_minutes && due !== null) {
          reminder = { before_due_minutes: before }
        }
      } else if (at !== null && at !== undefined && (before === null || before === undefined)) {
        const match = typeof at === 'string' ? MOMENT_RE.exec(at) : null
        if (match && isRealDate(match[1]) && isRealTime(match[2]) && at > referenceMinute) {
          reminder = { at: `${at}:00` }
        }
      }
      if (reminder === null) drop('reminder', task.reminder)
    }

    // 10. Place.
    let place: CheckedDraft['place'] = null
    if (task.place !== null && task.place !== undefined) {
      const { name, trigger } = task.place
      const matches = typeof name === 'string'
        ? ctx.places.filter((saved) => placeKey(saved.name) === placeKey(name)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        : []
      if (matches.length > 0 && (trigger === 'arrive' || trigger === 'leave')) place = { place_id: matches[0].id, trigger }
      else drop('place', task.place)
    }

    // 11. Subtasks.
    const subtasks: string[] = []
    for (const raw of Array.isArray(task.subtasks) ? task.subtasks : []) {
      if (typeof raw !== 'string') continue
      const text = takeUtf16(raw.replace(lineBreaks, ' ').trim(), AI_LIMITS.subtask_title_max_chars)
      if (text === '') continue
      if (subtasks.length >= AI_LIMITS.subtasks_max) break
      subtasks.push(text)
    }

    for (const field of Array.isArray(task.unsure) ? task.unsure : []) guessed.add(field)

    drafts.push({
      ref,
      title,
      notes,
      due,
      project_id: projectId,
      project_ref: projectRef,
      labels,
      priority,
      repeat,
      reminder,
      place,
      subtasks,
      guessed: sortedFields(guessed),
    })
  })

  return { drafts, dropped }
}

// --- The request (4.1) -------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The English weekday name of a local date. */
export function weekdayName(date: LocalDate): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Lowercased, compared by UTF-16 code units (semantics 12.2). */
export function compareLowercased(a: string, b: string): number {
  const left = lower(a)
  const right = lower(b)
  if (left !== right) return left < right ? -1 : 1
  // Equal when lowercased: the raw text decides, so the order never depends on the input's.
  return a < b ? -1 : a > b ? 1 : 0
}

export interface DictationContextInput {
  /** When the recording ended, local `YYYY-MM-DDTHH:mm` (seconds are dropped). */
  now: string
  timeZone: string
  /** The name of the list the user is in. */
  list: string
  default_project_id: number
  /** Projects the user can write to, not archived (any order: sorted here by lowercased path). */
  projects: readonly ContextProject[]
  labels: readonly string[]
  places: readonly string[]
}

/**
 * The context JSON of 4.1: the keys in the contract's order, written without extra spaces;
 * projects ordered by lowercased path, labels and places by lowercased name.
 */
export function dictationContextJson(input: DictationContextInput): string {
  const now = minuteOf(input.now)
  const context = {
    now,
    weekday: weekdayName(now.slice(0, 10)),
    time_zone: input.timeZone,
    week_starts: getWeekStart(),
    list: input.list,
    default_project_id: input.default_project_id,
    projects: [...input.projects]
      .sort((a, b) => compareLowercased(a.path, b.path))
      .map((project) => ({ id: project.id, title: project.title, path: project.path })),
    labels: [...input.labels].sort(compareLowercased),
    places: [...input.places].sort(compareLowercased),
  }
  return JSON.stringify(context)
}

/** The transcript as sent: `</transcript>` defused, then cut at the last space before 20,000 characters. */
export function transcriptForRequest(transcript: string): string {
  let text = transcript.split('</transcript>').join('</ transcript>')
  const max = AI_LIMITS.transcript_max_chars
  if (text.length > max) {
    const space = text.lastIndexOf(' ', max)
    text = space > 0 ? text.slice(0, space) : text.slice(0, max)
  }
  return text
}

/** The one user message of a dictation request (4.1), or of an edit by voice with its drafts block (4.4). */
export function dictationUserMessage(contextJson: string, transcript: string, drafts?: DraftsBlock): string {
  const parts = [`<context>\n${contextJson}\n</context>`]
  if (drafts) parts.push(`<drafts>\n${JSON.stringify(drafts)}\n</drafts>`)
  parts.push(`<transcript>\n${transcriptForRequest(transcript)}\n</transcript>`)
  return parts.join('\n')
}

/**
 * The current drafts in the model's own answer shape for an edit (4.4): after the checks and any
 * edits by hand, labels as names, the due date back as `when` with `said` null.
 */
export function draftsAsAnswer(
  drafts: readonly AnyCheckedDraft[],
  placeName: (placeId: string) => string | null,
): DraftsBlock {
  return {
    tasks: drafts.map((draft): DraftAnswer => {
      const dateOnly = draft.due !== null && draft.due.endsWith('T23:59:59')
      const reminder = draft.reminder === null
        ? null
        : 'before_due_minutes' in draft.reminder
          ? { before_due_minutes: draft.reminder.before_due_minutes, at: null }
          : { before_due_minutes: null, at: draft.reminder.at.slice(0, 16) }
      const place = draft.place ? placeName(draft.place.place_id) : null
      return {
        ref: draft.ref,
        title: draft.title,
        notes: draft.notes,
        when: {
          said: null,
          date: draft.due ? draft.due.slice(0, 10) : null,
          time: draft.due && !dateOnly ? draft.due.slice(11, 16) : null,
        },
        project_id: draft.project_id,
        labels: draft.labels.map((label) => label.title),
        priority: draft.priority,
        repeat: draft.repeat,
        reminder,
        place: draft.place && place ? { name: place, trigger: draft.place.trigger } : null,
        subtasks: [...draft.subtasks],
        unsure: [],
      }
    }),
  }
}

/** The fields whose value differs between two versions of a draft (highlighted after an edit by voice). */
export function changedFields(before: AnyCheckedDraft, after: AnyCheckedDraft): DraftField[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const changed: DraftField[] = []
  if (before.title !== after.title) changed.push('title')
  if (before.notes !== after.notes) changed.push('notes')
  if (before.due !== after.due) changed.push('when')
  if (before.project_id !== after.project_id || projectRefOf(before) !== projectRefOf(after)) changed.push('project')
  if (!same(before.labels.map((l) => lower(l.title)), after.labels.map((l) => lower(l.title)))) changed.push('labels')
  if (before.priority !== after.priority) changed.push('priority')
  if (!same(before.repeat, after.repeat)) changed.push('repeat')
  if (!same(before.reminder, after.reminder)) changed.push('reminder')
  if (!same(before.place, after.place)) changed.push('place')
  if (!same(before.subtasks, after.subtasks)) changed.push('subtasks')
  return changed
}

/** Local `YYYY-MM-DDTHH:mm:ss` of an instant, in the process time zone. */
export function localDateTimeOf(instant: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}:${pad(instant.getSeconds())}`
}

/** The instant of a local `YYYY-MM-DDTHH:mm[:ss]`, in the process time zone. */
export function instantOfLocal(local: string): Date {
  const [date, time = '00:00:00'] = local.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi, s = 0] = time.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi, s, 0)
}

/** The due date for the API (UTC ISO) of a checked draft's local `due`. */
export function dueForApi(due: string): string {
  return instantOfLocal(due).toISOString()
}

/** The task path of 4.1 (`Travel / Lisbon trip`) for a project, from the titles from the top. */
export function projectPath(
  projectId: number,
  projects: readonly { id: number; title: string; parent_project_id?: number | null }[],
): string {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const titles: string[] = []
  const seen = new Set<number>()
  let current = byId.get(projectId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    titles.unshift(current.title)
    current = current.parent_project_id ? byId.get(current.parent_project_id) : undefined
  }
  return titles.join(' / ')
}
