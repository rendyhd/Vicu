import { NULL_DATE } from './constants'
import { isDateOnly, isNoDueDate, parsedDue } from './due-dates'
import { formatDateChip } from './date-utils'
import { detectRecurrencePreset, formatRecurrenceLabel } from './recurrence'
import { recurrenceToVikunja, type ParseResult } from './task-parser'
import type { DateFormat } from './date-display'
import { priorityChipName, recurrenceChipName, type ChipData, type ChipSource } from './parse-chips'

// One source of truth for the new-task composer (card 3.5). A field shows, and saves, what the
// parser read from the typed text unless the user set that field with its own control (a picker),
// in which case the control wins. The chips, the buttons under the input and the save all read the
// result of `resolveComposerFields`, so nothing is saved that was not on screen.

export interface ComposerInput {
  /** What the parser read (already without the types the user set, see `pinType`). Null when the parser is off or nothing is typed. */
  parsed: ParseResult | null
  /** The date picked by hand: `touched` once the user used the picker (even to clear it). */
  dueTouched: boolean
  dueValue: string | null
  /** The date a list gives a new task (Today: today), or null. */
  contextDue: string | null
  contextDueDismissed: boolean
  /** The priority picked by hand (0 is "none" and wins over the text), or null when not picked. */
  priority: number | null
  projectTouched: boolean
  selectedProjectId: number
  /** The id of the project with this title (case-insensitive), if there is one. */
  findProjectId: (title: string) => number | undefined
  recurrenceTouched: boolean
  repeatAfter: number
  repeatMode: number
}

export type FieldSource = 'chip' | 'text' | 'default'

export interface ComposerFields {
  /** The due date to save, or null for none. */
  dueDate: string | null
  dueSource: FieldSource | null
  /** 0 for none. */
  priority: number
  prioritySource: FieldSource | null
  projectId: number
  projectSource: FieldSource
  /** True when the text names a project that does not exist, so the task goes to the selected one. */
  projectNotFound: boolean
  /** What to save for repeating, or null to leave it out. */
  repeat: { repeat_after: number; repeat_mode: number } | null
  repeatSource: FieldSource | null
}

export function resolveComposerFields(input: ComposerInput): ComposerFields {
  const { parsed } = input

  let dueDate: string | null = null
  let dueSource: FieldSource | null = null
  if (input.dueTouched) {
    if (input.dueValue && input.dueValue !== NULL_DATE) {
      dueDate = input.dueValue
      dueSource = 'chip'
    }
  } else if (parsed?.dueDate) {
    dueDate = parsedDue(parsed.dueDate, parsed.dueHasTime)
    dueSource = 'text'
  } else if (input.contextDue && !input.contextDueDismissed) {
    dueDate = input.contextDue
    dueSource = 'default'
  }

  let priority = 0
  let prioritySource: FieldSource | null = null
  if (input.priority !== null) {
    priority = input.priority
    prioritySource = priority > 0 ? 'chip' : null
  } else if (parsed?.priority && parsed.priority > 0) {
    priority = parsed.priority
    prioritySource = 'text'
  }

  let projectId = input.selectedProjectId
  let projectSource: FieldSource = input.projectTouched ? 'chip' : 'default'
  let projectNotFound = false
  if (!input.projectTouched && parsed?.project) {
    const found = input.findProjectId(parsed.project)
    if (found !== undefined) {
      projectId = found
      projectSource = 'text'
    } else {
      projectNotFound = true
    }
  }

  let repeat: ComposerFields['repeat'] = null
  let repeatSource: FieldSource | null = null
  if (input.recurrenceTouched) {
    repeat = { repeat_after: input.repeatAfter, repeat_mode: input.repeatMode }
    repeatSource = detectRecurrencePreset(input.repeatAfter, input.repeatMode) !== 'none' ? 'chip' : null
  } else if (parsed?.recurrence) {
    const mapped = recurrenceToVikunja(parsed.recurrence)
    repeat = { repeat_after: mapped.repeat_after, repeat_mode: mapped.repeat_mode }
    repeatSource = 'text'
  }

  return { dueDate, dueSource, priority, prioritySource, projectId, projectSource, projectNotFound, repeat, repeatSource }
}

/** True while the caret is still in the project word ("+Pe" at the end of the text): the name may be unfinished. */
function projectTokenOpen(parsed: ParseResult, text: string | undefined): boolean {
  if (text === undefined) return false
  const token = parsed.tokens.find((t) => t.type === 'project')
  return !!token && text.slice(token.end).length === 0
}

export interface ComposerChipInput {
  fields: ComposerFields
  parsed: ParseResult | null
  /** Titles of the labels picked by hand. */
  chipLabels: string[]
  projectTitle: string
  fmt: DateFormat
  now?: Date
  /** The typed text. Without it a project token counts as finished. */
  text?: string
}

/**
 * The chips of the composer: the date (weekday and date, with the time when there is one), the
 * priority name, the labels, the project and the repeat, each from the text or from the control
 * that was used. A default date from the list is not a chip here (the composer shows it apart).
 */
export function composerChips({ fields, parsed, chipLabels, projectTitle, fmt, now = new Date(), text }: ComposerChipInput): ChipData[] {
  const chips: ChipData[] = []
  const source = (s: FieldSource | null): ChipSource => (s === 'chip' ? 'chip' : 'text')

  if (fields.dueDate && fields.dueSource !== 'default' && !isNoDueDate(fields.dueDate)) {
    chips.push({
      type: 'date',
      key: 'date',
      source: source(fields.dueSource),
      label: formatDateChip(new Date(fields.dueDate), isDateOnly(fields.dueDate), now, fmt),
    })
  }
  if (fields.priority > 0) {
    chips.push({ type: 'priority', key: 'priority', source: source(fields.prioritySource), label: priorityChipName(fields.priority), priority: fields.priority })
  }
  const seen = new Set<string>()
  for (const title of chipLabels) {
    if (seen.has(title.toLowerCase())) continue
    seen.add(title.toLowerCase())
    chips.push({ type: 'label', key: `label-chip-${title}`, source: 'chip', label: title })
  }
  for (const name of parsed?.labels ?? []) {
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    chips.push({ type: 'label', key: `label-${name}`, source: 'text', label: name })
  }
  if (fields.projectSource === 'chip') {
    chips.push({ type: 'project', key: 'project', source: 'chip', label: projectTitle })
  } else if (parsed?.project) {
    chips.push({
      type: 'project',
      key: 'project',
      source: 'text',
      label: fields.projectNotFound && !projectTokenOpen(parsed, text) ? `${parsed.project} (no such project)` : fields.projectNotFound ? parsed.project : projectTitle,
    })
  }
  if (fields.repeat && fields.repeatSource) {
    const text = parsed?.recurrence
    const label =
      fields.repeatSource === 'chip' || !text
        ? formatRecurrenceLabel(fields.repeat.repeat_after, fields.repeat.repeat_mode)
        : recurrenceChipName(text.interval, text.unit)
    if (label) chips.push({ type: 'recurrence', key: 'recurrence', source: source(fields.repeatSource), label })
  }
  return chips
}
