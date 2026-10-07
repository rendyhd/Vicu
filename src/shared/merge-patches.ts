/**
 * JSON merge patch builders for Vikunja API v2, shared by the main process and
 * the renderer. Port of vicu-android `MergePatches` (D-REN-2, D-PROJ-1).
 *
 * Why this exists: a PATCH body is a merge patch with `additionalProperties:
 * false`. Sending the whole cached object reverts anything another client changed
 * since the cache was filled, and unknown keys (such as a project tree node's
 * `children`) are rejected with a 422. So every edit sends only the writable
 * fields that actually changed.
 *
 * This file must stay free of imports so any tsconfig can include it.
 */

/** Vikunja's null date; `due_date: null` in a patch clears the date. */
export const NULL_DATE = '0001-01-01T00:00:00Z'

/** Writable task properties of `PATCH /tasks/{id}` (api-docs.json). `position` is per view and not writable here. */
export const TASK_WRITABLE_FIELDS = [
  'title',
  'description',
  'done',
  'due_date',
  'start_date',
  'end_date',
  'priority',
  'project_id',
  'repeat_after',
  'repeat_mode',
  'hex_color',
  'percent_done',
  'bucket_id',
  'cover_image_attachment_id',
  'is_favorite',
  'reminders',
] as const

/** Response-only task properties; a patch never contains these. */
export const TASK_READ_ONLY_FIELDS = [
  '$schema',
  'id',
  'created',
  'updated',
  'created_by',
  'done_at',
  'identifier',
  'index',
  'labels',
  'assignees',
  'attachments',
  'related_tasks',
  'position',
  'kanban_position',
  'max_permission',
] as const

/** Writable project properties of `PATCH /projects/{id}` (api-docs.json). */
export const PROJECT_WRITABLE_FIELDS = [
  'title',
  'description',
  'hex_color',
  'identifier',
  'is_archived',
  'is_favorite',
  'parent_project_id',
  'position',
] as const

export type TaskWritableField = (typeof TASK_WRITABLE_FIELDS)[number]
export type ProjectWritableField = (typeof PROJECT_WRITABLE_FIELDS)[number]

export interface ReminderPatch {
  reminder?: string
  relative_period?: number
  relative_to?: string
}

export interface TaskPatch {
  title?: string
  description?: string
  done?: boolean
  /** `null` clears the date. */
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  priority?: number
  project_id?: number
  repeat_after?: number
  repeat_mode?: number
  hex_color?: string
  percent_done?: number
  bucket_id?: number
  cover_image_attachment_id?: number
  is_favorite?: boolean
  reminders?: ReminderPatch[]
}

export interface ProjectPatch {
  title?: string
  description?: string
  hex_color?: string
  identifier?: string
  is_archived?: boolean
  is_favorite?: boolean
  parent_project_id?: number
  position?: number
}

/**
 * Loose input shapes. Every writable field is optional and `unknown`, so a full
 * `Task`/`Project`, a partial update and a plain JSON object all fit.
 */
export type TaskInput = { [K in TaskWritableField]?: unknown }
export type ProjectInput = { [K in ProjectWritableField]?: unknown }

const DATE_FIELDS = ['due_date', 'start_date', 'end_date'] as const
const PLAIN_TASK_FIELDS = [
  'title',
  'description',
  'done',
  'priority',
  'project_id',
  'percent_done',
  'bucket_id',
  'cover_image_attachment_id',
  'is_favorite',
] as const

type Out = Record<string, unknown>

function isNullDate(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('0001-01-01')
}

/** Blank, null and the Go zero time all mean "no date". */
function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  if (value.trim() === '' || isNullDate(value)) return null
  return value
}

function sameDate(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  if (a === b) return true
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return !Number.isNaN(ta) && !Number.isNaN(tb) && ta === tb
}

function stripHash(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/^#/, '') : undefined
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * API v2 validates `reminder` as an RFC 3339 date-time and rejects the whole
 * request on `""`. A relative reminder may omit it (the server fills it in) and
 * an absolute one omits the blank `relative_to`. Unknown keys are dropped because
 * the schema forbids additional properties. Returns null when nothing is left to
 * schedule.
 */
export function sanitizeReminder(raw: unknown): ReminderPatch | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const out: ReminderPatch = {}
  if (typeof source.reminder === 'string' && !isBlank(source.reminder) && !isNullDate(source.reminder)) {
    out.reminder = source.reminder
  }
  if (typeof source.relative_period === 'number' && Number.isFinite(source.relative_period)) {
    out.relative_period = source.relative_period
  }
  if (typeof source.relative_to === 'string' && !isBlank(source.relative_to)) {
    out.relative_to = source.relative_to
  }
  if (out.reminder === undefined && out.relative_to === undefined) return null
  return out
}

export function sanitizeReminders(value: unknown): ReminderPatch[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const reminder = sanitizeReminder(item)
    return reminder ? [reminder] : []
  })
}

function sameReminders(a: ReminderPatch[], b: ReminderPatch[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** True when `original` knows this field, so comparing is meaningful. */
function known(original: object | null | undefined, key: string): boolean {
  return original != null && (original as Out)[key] !== undefined
}

/**
 * Build the merge patch that turns `original` into `edited`.
 *
 * - Only writable fields appear; read-only fields (id, labels, related_tasks,
 *   position, ...) never do.
 * - A field is sent when it differs from `original`, or when `original` is null or
 *   does not carry it. Fields missing from `edited` are never sent, so a partial
 *   edit like `{ priority: 2 }` yields exactly that change.
 * - Empty dates are sent as `null`; recurrence is always sent as the pair
 *   `repeat_after` + `repeat_mode`; reminders are sanitized (never `reminder: ""`).
 */
export function taskPatch(original: TaskInput | null | undefined, edited: TaskInput): TaskPatch {
  const out: Out = {}
  const prev = (original ?? null) as Out | null
  const next = edited as Out

  for (const key of PLAIN_TASK_FIELDS) {
    const value = next[key]
    if (value === undefined) continue
    if (!known(prev, key) || prev![key] !== value) out[key] = value
  }

  for (const key of DATE_FIELDS) {
    if (next[key] === undefined) continue
    const value = normalizeDate(next[key])
    if (!known(prev, key) || !sameDate(normalizeDate(prev![key]), value)) out[key] = value
  }

  if (next.hex_color !== undefined) {
    const value = stripHash(next.hex_color)
    if (value !== undefined && (!known(prev, 'hex_color') || stripHash(prev!.hex_color) !== value)) {
      out.hex_color = value
    }
  }

  if (next.repeat_after !== undefined || next.repeat_mode !== undefined) {
    // Recurrence is a two-field value: patch both halves together so a queued or
    // partial update cannot create a hybrid of the old and the new schedule.
    const after = next.repeat_after !== undefined ? next.repeat_after : prev?.repeat_after
    const mode = next.repeat_mode !== undefined ? next.repeat_mode : prev?.repeat_mode
    const changed =
      !known(prev, 'repeat_after') ||
      !known(prev, 'repeat_mode') ||
      prev!.repeat_after !== after ||
      prev!.repeat_mode !== mode
    if (changed) {
      if (after !== undefined) out.repeat_after = after
      if (mode !== undefined) out.repeat_mode = mode
    }
  }

  if (next.reminders !== undefined) {
    const value = sanitizeReminders(next.reminders)
    if (!known(prev, 'reminders') || !sameReminders(sanitizeReminders(prev!.reminders), value)) {
      out.reminders = value
    }
  }

  return out as TaskPatch
}

/**
 * Build the merge patch that turns `original` into `edited` for a project.
 * Only writable fields appear (never `children`, `views`, `owner`, ...), and
 * `parent_project_id` is only sent when it actually changes.
 */
export function projectPatch(original: ProjectInput | null | undefined, edited: ProjectInput): ProjectPatch {
  const out: Out = {}
  const prev = (original ?? null) as Out | null
  const next = edited as Out

  for (const key of PROJECT_WRITABLE_FIELDS) {
    const value = next[key]
    if (value === undefined) continue
    if (key === 'hex_color') {
      const stripped = stripHash(value)
      if (stripped !== undefined && (!known(prev, key) || stripHash(prev![key]) !== stripped)) {
        out[key] = stripped
      }
      continue
    }
    if (!known(prev, key) || prev![key] !== value) out[key] = value
  }

  return out as ProjectPatch
}

/**
 * Last line of defence for the main process: reduce any task-shaped object (a
 * cached task, a queued legacy payload) to a valid writable patch without diffing.
 */
export function sanitizeTaskPatch(patch: Record<string, unknown>): TaskPatch {
  return taskPatch(null, patch as TaskInput)
}

export function sanitizeProjectPatch(patch: Record<string, unknown>): ProjectPatch {
  return projectPatch(null, patch as ProjectInput)
}
