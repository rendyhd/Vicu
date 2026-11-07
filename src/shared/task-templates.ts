/**
 * Task templates (docs/cross-app-semantics-v1.md section 18): a task to start from, one
 * `template.<id>` entry of the synced preferences. Android has the same rules (`TaskTemplates`); both
 * run the `taskTemplates` vectors of `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, dateOnlyDue, diffLocalDays, isDateOnly, isNoDueDate, localDateOf, type LocalDate } from './due-dates'

export const TEMPLATE_KEY_PREFIX = 'template.'
/** Section 18.1: the carrier is one description. */
export const MAX_TEMPLATE_BYTES = 16 * 1024

export interface TemplateDue {
  days: number
  /** `HH:mm`; left out for a date-only due date. */
  time?: string
}

export interface TemplateReminder {
  relative_period: number
  relative_to: string
}

/** A field at its default is not written. Unknown fields at the top level are kept. */
export interface TaskTemplate {
  title: string
  project_id?: number
  notes?: string
  labels?: number[]
  priority?: number
  due?: TemplateDue
  repeat_after?: number
  repeat_mode?: number
  reminders?: TemplateReminder[]
  subtasks?: TaskTemplate[]
  created_ms?: number
  [unknownField: string]: unknown
}

export type ListedTemplate = TaskTemplate & { id: string }

/** A task with its subtasks, as far as they are known. */
export interface TemplateSource {
  title: string
  project_id?: number
  description?: string
  labels?: Array<{ id: number }> | null
  priority?: number
  due_date?: string | null
  repeat_after?: number
  repeat_mode?: number
  reminders?: Array<{ relative_period?: number; relative_to?: string }> | null
  subtasks?: TemplateSource[]
}

export function templateKey(id: string): string {
  return `${TEMPLATE_KEY_PREFIX}${id}`
}

/** The template `value` holds, or null when it is not one: it is then ignored and kept. */
export function readTemplate(value: unknown): TaskTemplate | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const title = (value as { title?: unknown }).title
  if (typeof title !== 'string' || !title.trim()) return null
  return value as TaskTemplate
}

/** The account's templates, oldest first. */
export function readTemplates(values: Readonly<Record<string, unknown>>): ListedTemplate[] {
  const listed: ListedTemplate[] = []
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(TEMPLATE_KEY_PREFIX) || key.length === TEMPLATE_KEY_PREFIX.length) continue
    const template = readTemplate(value)
    if (template) listed.push({ ...template, id: key.slice(TEMPLATE_KEY_PREFIX.length) })
  }
  return listed.sort((a, b) => (a.created_ms ?? 0) - (b.created_ms ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** What is written: fields at their default go, and so does the entry's id. */
export function encodeTemplate(template: TaskTemplate): TaskTemplate {
  const { id: _id, ...rest } = template as TaskTemplate & { id?: string }
  const written: TaskTemplate = { title: template.title }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null || value === '' || value === 0) continue
    if (Array.isArray(value) && value.length === 0) continue
    written[key] = key === 'subtasks' ? (value as TaskTemplate[]).map(encodeTemplate) : value
  }
  return written
}

export function isTemplateTooLarge(template: TaskTemplate): boolean {
  return new TextEncoder().encode(JSON.stringify(encodeTemplate(template))).length > MAX_TEMPLATE_BYTES
}

/** A due date as a template keeps it: days from today, never below 0, and its time of day. */
export function templateDueOf(dueDate: string | null | undefined, today: LocalDate): TemplateDue | undefined {
  if (!dueDate || isNoDueDate(dueDate)) return undefined
  const days = Math.max(0, diffLocalDays(today, localDateOf(dueDate)))
  if (isDateOnly(dueDate)) return { days }
  const local = new Date(dueDate)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { days, time: `${pad(local.getHours())}:${pad(local.getMinutes())}` }
}

/** Only reminders that count from the due date travel; the others name a moment or a block. */
export function relativeReminders(reminders: ReadonlyArray<{ relative_period?: number; relative_to?: string }> | null | undefined): TemplateReminder[] {
  return (reminders ?? [])
    .filter((reminder) => reminder.relative_to === 'due_date')
    .map((reminder) => ({ relative_period: reminder.relative_period ?? 0, relative_to: 'due_date' }))
}

function withoutImages(notes: string): string {
  return notes.replace(/<img\b[^>]*>/gi, '').replace(/\s*\[\[image(-pending)?:[^\]]*]]/g, '').trim()
}

function captureNode(source: TemplateSource, today: LocalDate): TaskTemplate {
  const due = templateDueOf(source.due_date, today)
  return {
    title: source.title,
    notes: withoutImages(source.description ?? ''),
    labels: (source.labels ?? []).map((label) => label.id),
    priority: source.priority ?? 0,
    due,
    repeat_after: source.repeat_after ?? 0,
    repeat_mode: source.repeat_mode ?? 0,
    reminders: due ? relativeReminders(source.reminders) : [],
    subtasks: (source.subtasks ?? []).map((child) => captureNode(child, today)),
  }
}

/** What `source` saves as a template (section 18.1); the caller gives it an id and a time. */
export function captureTemplate(source: TemplateSource, today: LocalDate): TaskTemplate {
  return encodeTemplate({ ...captureNode(source, today), project_id: source.project_id })
}

/** The due date a task made today gets, or null. */
export function templateDueDate(due: TemplateDue | undefined, today: LocalDate): string | null {
  if (!due) return null
  const date = addLocalDays(today, Math.max(0, due.days))
  if (!due.time) return dateOnlyDue(date)
  return new Date(`${date}T${due.time}:00`).toISOString()
}

/** Section 18.2: its own project while the person can still write there, else where a new task would go. */
export function templateProject(template: TaskTemplate, writable: ReadonlySet<number>, fallback: number): number {
  return template.project_id !== undefined && writable.has(template.project_id) ? template.project_id : fallback
}

/** Section 18.3: a subtask kept by an edit, matched by title, keeps its fields and subtasks. */
export function withSubtaskTitles(old: readonly TaskTemplate[], titles: readonly string[]): TaskTemplate[] {
  const left = [...old]
  return titles.map((title) => {
    const at = left.findIndex((subtask) => subtask.title === title)
    return at >= 0 ? left.splice(at, 1)[0] : { title }
  })
}
