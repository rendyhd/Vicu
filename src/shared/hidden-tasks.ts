/**
 * Hidden tasks (docs/cross-app-semantics-v1.md section 10): the ordinary Vikunja tasks Vicu keeps
 * its synced data in (custom-list carrier, routine carriers and archive parts, the preferences
 * carrier). One module for the rules every kind shares, used by the main process and the renderer;
 * Android has the same rules in `util/HiddenTasks.kt`. Pinned by the `hiddenTasks` vectors of
 * `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Import-free on purpose, so every tsconfig can include it.
 */

/**
 * A task is hidden when its description holds a Vicu carrier marker, whatever the kind (known or
 * not): a later version can add a kind without this one showing it. `vicu-duration` is the exception:
 * it is inline metadata on an ordinary task, never a carrier. Only space, tab, CR and LF count as
 * whitespace here (`\s` would also take a no-break space, which the vectors pin as not hidden), and
 * the match is case sensitive. The title never decides.
 */
export const HIDDEN_TASK_MARKER_RE = /<!--[ \t\r\n]*vicu-(?!duration:)[a-z0-9-]+:/

/** True for a hidden task's description: never listed, counted or searched as a user task. */
export function isHiddenTask(description?: string | null): boolean {
  return typeof description === 'string' && HIDDEN_TASK_MARKER_RE.test(description)
}

/**
 * The start of one kind's marker (`vicu-<kind>:`), with the same whitespace rule as the hiding test.
 * `kind` is a literal such as `custom-lists`, `routine` or `prefs`.
 */
export function kindMarkerPattern(kind: string): RegExp {
  return new RegExp(`<!--[ \\t\\r\\n]*vicu-${kind.replace(/[^a-z0-9:-]/g, '')}:`)
}

/** Vikunja's null date (Go zero time). */
export const HIDDEN_TASK_NULL_DATE = '0001-01-01T00:00:00Z'

/**
 * The fields every hidden-task write sends again (section 10.2), so an edit made in Vikunja's web
 * UI (reopened, given a due date, a repeat or reminders) is undone by the next write. A fresh object
 * each time: callers may change it.
 */
export function hiddenTaskForcedFields(): {
  done: true
  due_date: string
  repeat_after: 0
  repeat_mode: 0
  reminders: []
} {
  return { done: true, due_date: HIDDEN_TASK_NULL_DATE, repeat_after: 0, repeat_mode: 0, reminders: [] }
}

/** A hidden task's JSON is written within this many bytes (section 10.8). */
export const HIDDEN_TASK_WRITE_MAX_BYTES = 384 * 1024
/** The most an app accepts when it reads one. */
export const HIDDEN_TASK_READ_MAX_BYTES = 512 * 1024

// --- Ownership (section 10.3) ---------------------------------------------------------------

/** The part of a task the owner rule reads. */
export interface OwnedTask {
  id: number
  created_by?: { id?: unknown } | null
}

/** Who created the task (set by the server), or null when the task does not say. */
export function createdById(task: { created_by?: { id?: unknown } | null }): number | null {
  const id = task.created_by?.id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

/**
 * True when the signed-in user (`me`) created the task. Until the app knows its user id
 * (`me` null or undefined) no task is its own, so nothing is discovered, merged, written or deleted.
 */
export function isOwnTask(task: { created_by?: { id?: unknown } | null }, me: number | null | undefined): boolean {
  return typeof me === 'number' && me > 0 && createdById(task) === me
}

/** The signed-in user's carriers among `tasks`, lowest id first. */
export function ownCarriers<T extends OwnedTask>(tasks: readonly T[], me: number | null | undefined): T[] {
  return tasks.filter((task) => isOwnTask(task, me)).sort((a, b) => a.id - b.id)
}

/** The carrier that is written: the user's own carrier with the lowest id, or null (section 10.5). */
export function carrierToWrite<T extends OwnedTask>(tasks: readonly T[], me: number | null | undefined): T | null {
  return ownCarriers(tasks, me)[0] ?? null
}

// --- Revisions and tombstones (section 10.6) ------------------------------------------------

export interface SyncRevision {
  wall_time_ms: number
  counter: number
  device_id: string
}

/** Positive when `left` is newer: wall time, then counter, then device id (compared as a string). */
export function compareRevisions(left: SyncRevision, right: SyncRevision): number {
  return left.wall_time_ms - right.wall_time_ms ||
    left.counter - right.counter ||
    (left.device_id < right.device_id ? -1 : left.device_id > right.device_id ? 1 : 0)
}

/** True for a revision that is a well-formed `{ wall_time_ms, counter, device_id }`. */
export function isSyncRevision(value: unknown): value is SyncRevision {
  if (!value || typeof value !== 'object') return false
  const revision = value as Partial<SyncRevision>
  return Number.isFinite(revision.wall_time_ms) &&
    Number.isInteger(revision.counter) && (revision.counter as number) >= 0 &&
    typeof revision.device_id === 'string' && revision.device_id !== ''
}

/** Deleted records are remembered as tombstones for this long, then dropped (90 days). */
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/** A record holding `value: null` whose revision is older than 90 days before `now`. */
export function isExpiredTombstone(
  record: { value?: unknown; revision: { wall_time_ms: number } },
  now: number,
): boolean {
  return (record.value === null || record.value === undefined) && record.revision.wall_time_ms < now - TOMBSTONE_MAX_AGE_MS
}

/** The records without the expired tombstones; the same object when nothing was dropped. */
export function pruneTombstoneRecords<R extends { value?: unknown; revision: { wall_time_ms: number } }>(
  records: Record<string, R>,
  now: number,
): Record<string, R> {
  const kept: Record<string, R> = {}
  let dropped = false
  for (const [key, record] of Object.entries(records)) {
    if (isExpiredTombstone(record, now)) dropped = true
    else kept[key] = record
  }
  return dropped ? kept : records
}

// --- Canonical JSON ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level, so two documents compare by content only. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const entry = (value as Record<string, unknown>)[key]
    if (entry !== undefined) sorted[key] = sortKeys(entry)
  }
  return sorted
}
