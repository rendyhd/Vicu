import { parse, type ParseResult, type ParserConfig } from '../task-parser'
import { composerChips, resolveComposerFields, type ComposerFields } from '../composer-fields'
import { dateOnlyDue, isDateOnly, toLocalDate } from '../due-dates'
import { formatDateDisplay, type DateFormat } from '../date-display'
import { formatDateChip } from '../date-utils'
import type { ChipData } from '../parse-chips'
import type { CreateTaskPayload } from '../vikunja-types'
import { withDefaultReminder, type DefaultReminderSettings } from '../../../shared/default-reminder'
import { withTaskDuration } from '../task-duration'

// One spoken sentence as a new task, read like quick add (docs/voice-input.md): the quick-add
// parser with the user's settings and the composer's field rules with nothing picked by hand. The
// list on screen gives the same defaults as its composer (its project, Today's date), the words
// win over them (a project or date they name), and without a list the task goes to the Inbox. Then
// the labels it names and the default reminder for a due date. Pure: the caller creates the task.

/** What the list on screen gives its composer (TaskList's `projectId` and `defaultDueDate`). */
export interface VoiceListDefaults {
  projectId: number | null
  defaultDueDate: Date | null
}

export interface VoiceTaskContext {
  parserConfig: ParserConfig
  /** The active projects (an archived or deleted one is not in it). */
  projects: readonly { id: number; title: string }[]
  inboxProjectId: number
  /** The composer defaults of the list on screen when the capture started; none: the Inbox, no date. */
  list?: VoiceListDefaults | null
  /** The default reminder settings (src/shared/default-reminder.ts, the same rule as typing). */
  defaultReminder?: DefaultReminderSettings | null
  now?: Date
}

export type VoiceTaskDraft =
  | {
      ok: true
      title: string
      projectId: number
      /** The project's name when it is not the Inbox (for the confirmation). */
      projectTitle: string | null
      payload: CreateTaskPayload
      labelNames: string[]
      parsed: ParseResult
    }
  | { ok: false; reason: 'empty' | 'no-inbox'; message: string }

/** Speech recognizers end a sentence with a full stop or capitalise oddly; quick add does not expect either. */
export function cleanTranscript(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').trim()
}

/** The project a new task starts in: the list's own when it still exists, else the Inbox. */
function startProject(ctx: VoiceTaskContext): number {
  const listProject = ctx.list?.projectId
  return listProject && ctx.projects.some((project) => project.id === listProject) ? listProject : ctx.inboxProjectId
}

/** The fields the task gets: the composer's rules over what was said, with the list's defaults. */
export function voiceFields(parsed: ParseResult | null, ctx: VoiceTaskContext): ComposerFields {
  const listDue = ctx.list?.defaultDueDate
  return resolveComposerFields({
    parsed,
    dueTouched: false,
    dueValue: null,
    // The same date-only due date the composer gives a task from this list.
    contextDue: listDue ? dateOnlyDue(toLocalDate(listDue)) : null,
    contextDueDismissed: false,
    priority: null,
    projectTouched: false,
    selectedProjectId: startProject(ctx),
    findProjectId: (title) => ctx.projects.find((project) => project.title.toLowerCase() === title.toLowerCase())?.id,
    recurrenceTouched: false,
    repeatAfter: 0,
    repeatMode: 0,
  })
}

function projectTitleOf(projectId: number, ctx: VoiceTaskContext): string | null {
  return projectId === ctx.inboxProjectId ? null : ctx.projects.find((project) => project.id === projectId)?.title ?? null
}

export function voiceTaskDraft(text: string, ctx: VoiceTaskContext): VoiceTaskDraft {
  const input = cleanTranscript(text)
  if (!input) return { ok: false, reason: 'empty', message: 'Nothing was heard.' }
  if (!ctx.inboxProjectId) return { ok: false, reason: 'no-inbox', message: 'Choose an Inbox in Settings first.' }

  // parse() also applies the `!` today shortcut when the parser is off.
  const parsed = parse(input, ctx.parserConfig, ctx.now ?? new Date())
  const fields = voiceFields(parsed, ctx)
  const title = parsed.title.trim()
  if (!title) return { ok: false, reason: 'empty', message: 'Say what the task is.' }

  let payload: CreateTaskPayload = { title }
  if (fields.dueDate) payload.due_date = fields.dueDate
  if (fields.priority > 0) payload.priority = fields.priority
  if (fields.repeat) Object.assign(payload, fields.repeat)
  payload = withDefaultReminder(payload, ctx.defaultReminder)
  if (parsed.durationMinutes !== null) payload.description = withTaskDuration(payload.description, parsed.durationMinutes)

  return {
    ok: true,
    title,
    projectId: fields.projectId,
    projectTitle: projectTitleOf(fields.projectId, ctx),
    payload,
    labelNames: [...new Set(parsed.labels)],
    parsed,
  }
}

/**
 * The chips of the voice card: what the words say (the composer's chips) plus, before and while
 * anything is said, the list's own date and project, so the card shows where the task will go.
 * The Inbox gets no chip. `parsed` is null while nothing has been heard.
 */
export function voiceCardChips(parsed: ParseResult | null, text: string, ctx: VoiceTaskContext, fmt: DateFormat): ChipData[] {
  const fields = voiceFields(parsed, ctx)
  const now = ctx.now ?? new Date()
  const projectTitle = projectTitleOf(fields.projectId, ctx)
  const chips = composerChips({ fields, parsed, chipLabels: [], projectTitle: projectTitle ?? '', fmt, now, text })
  if (fields.dueSource === 'default' && fields.dueDate) {
    chips.unshift({ type: 'date', key: 'list-date', label: formatDateChip(new Date(fields.dueDate), isDateOnly(fields.dueDate), now, fmt) })
  }
  if (fields.projectSource === 'default' && projectTitle && !chips.some((chip) => chip.type === 'project')) {
    chips.push({ type: 'project', key: 'list-project', label: projectTitle })
  }
  return chips
}

/**
 * The toast after a voice add: `Added “Call mom”, tomorrow, 15:00` or `Added “Report” to Work`.
 * The date is the row's phrase (date-display.ts), with Today and Tomorrow in lower case.
 */
export function voiceConfirmation(
  draft: { title: string; projectTitle: string | null; payload: Pick<CreateTaskPayload, 'due_date'> },
  now: Date,
  fmt: DateFormat,
): string {
  let text = `Added “${draft.title}”`
  if (draft.projectTitle) text += ` to ${draft.projectTitle}`
  const due = draft.payload.due_date
  if (due) {
    const phrase = formatDateDisplay('row', new Date(due), now, isDateOnly(due), fmt)
    if (phrase) text += `, ${/^(Today|Tomorrow)\b/.test(phrase) ? phrase[0].toLowerCase() + phrase.slice(1) : phrase}`
  }
  return text
}
