/**
 * Synced preferences (docs/cross-app-semantics-v1.md section 11): the settings that change what a
 * list shows or how input is read, kept in one hidden carrier per account (`vicu-prefs:v1`). This
 * module holds the document rules (merge, pruning, reading a key, the one-time move); the main
 * process keeps the local copy and the carrier (`src/main/synced-preferences.ts`). Android has the
 * same rules; both run the `syncedPrefs` vectors of `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import {
  canonicalJson,
  compareRevisions,
  isSyncRevision,
  pruneTombstoneRecords,
  type SyncRevision,
} from './hidden-tasks'
import { DEFAULT_TASK_ORDER, GLOBAL_TASK_ORDER_KEY, parseTaskOrder, type TaskOrderKey } from './task-order'
import {
  CATEGORY_KEY_PREFIX,
  categoryIdOfKey,
  projectIdOfCategoryKey,
  PROJECT_CATEGORY_KEY_PREFIX,
  readCategoryPref,
  readProjectCategoryPref,
} from './project-categories'

export const SYNCED_PREFS_VERSION = 1

/** One setting. `value` is any JSON value; `null` means "the default". Unknown fields are kept. */
export interface SyncedPrefsEntry {
  value: unknown
  revision: SyncRevision
  [unknownField: string]: unknown
}

export interface SyncedPrefsDocument {
  version: number
  entries: Record<string, SyncedPrefsEntry>
  [unknownField: string]: unknown
}

/** What the windows get from the main process (`synced-prefs:get`, `synced-prefs-changed`). */
export interface SyncedPrefsSnapshot {
  /** Every entry's value by key (`null` for a reset). */
  values: Record<string, unknown>
  /** The Inbox in use (the local cache, `config.inbox_project_id`). */
  inboxProjectId: number
  /** Set once, when the first read of the carrier switched this device to the account's Inbox. */
  adoptedInbox?: number
}

export function emptySyncedPrefs(): SyncedPrefsDocument {
  return { version: SYNCED_PREFS_VERSION, entries: {} }
}

/**
 * `merge(local, server)`: the union of keys; for a key on both sides the newer revision wins and
 * equal revisions keep the server's entry (with its unknown fields). Unknown fields at the top level
 * are the union of both sides, the server's value kept for a field on both. No pruning here: the
 * caller prunes before writing and before comparing (section 10.6).
 */
export function mergeSyncedPrefs(local: SyncedPrefsDocument, server: SyncedPrefsDocument): SyncedPrefsDocument {
  const entries: Record<string, SyncedPrefsEntry> = {}
  for (const key of new Set([...Object.keys(local.entries), ...Object.keys(server.entries)])) {
    const mine = local.entries[key]
    const theirs = server.entries[key]
    entries[key] = !mine ? theirs : !theirs ? mine : compareRevisions(mine.revision, theirs.revision) > 0 ? mine : theirs
  }
  return { ...local, ...server, entries }
}

/** The document without tombstones older than 90 days before `now`. */
export function pruneSyncedPrefs(document: SyncedPrefsDocument, now: number): SyncedPrefsDocument {
  const entries = pruneTombstoneRecords(document.entries, now)
  return entries === document.entries ? document : { ...document, entries }
}

/** Same content, whatever the key order. */
export function sameSyncedPrefs(left: SyncedPrefsDocument, right: SyncedPrefsDocument): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

/** True when the document holds at least one entry (only then is a carrier created). */
export function hasSyncedPrefsEntries(document: SyncedPrefsDocument): boolean {
  return Object.keys(document.entries).length > 0
}

/**
 * Checks a decoded document. A version this app does not know is reported by the caller before it
 * gets here (it makes the kind read only); anything else that does not fit is malformed.
 */
export function validateSyncedPrefs(value: unknown): asserts value is SyncedPrefsDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Preferences metadata is invalid')
  const document = value as Partial<SyncedPrefsDocument>
  if (document.version !== SYNCED_PREFS_VERSION) throw new Error('Preferences payload version mismatch')
  if (!document.entries || typeof document.entries !== 'object' || Array.isArray(document.entries)) {
    throw new Error('Preferences metadata structure is invalid')
  }
  for (const [key, entry] of Object.entries(document.entries)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Preference ${key} is invalid`)
    if (!isSyncRevision((entry as SyncedPrefsEntry).revision)) throw new Error(`Preference ${key} has an invalid revision`)
  }
}

/** The revision for a change made now on this device: newer than every revision in the document. */
export function nextSyncedPrefsRevision(document: SyncedPrefsDocument, deviceId: string, now: number): SyncRevision {
  const revisions = Object.values(document.entries).map((entry) => entry.revision)
  const maxWall = revisions.reduce((max, revision) => Math.max(max, revision.wall_time_ms), 0)
  const wallTime = Math.max(now, maxWall)
  const maxCounter = revisions
    .filter((revision) => revision.wall_time_ms === wallTime)
    .reduce((max, revision) => Math.max(max, revision.counter), -1)
  return {
    wall_time_ms: wallTime,
    counter: wallTime === now && now > maxWall ? 0 : maxCounter + 1,
    device_id: deviceId,
  }
}

/**
 * The document with `key` set to `value` (`null` resets it to the default on every device). The
 * entry's unknown fields stay.
 */
export function setSyncedPref(
  document: SyncedPrefsDocument,
  key: string,
  value: unknown,
  deviceId: string,
  now: number,
): SyncedPrefsDocument {
  const revision = nextSyncedPrefsRevision(document, deviceId, now)
  const previous = document.entries[key]
  return {
    ...document,
    entries: { ...document.entries, [key]: { ...(previous ?? {}), value: value === undefined ? null : value, revision } },
  }
}

/** The value of every entry by key (`null` for a reset). */
export function syncedPrefValues(document: SyncedPrefsDocument): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(document.entries)) values[key] = entry.value === undefined ? null : entry.value
  return values
}

// --- The registry (section 11.3) ------------------------------------------------------------

export const INBOX_PROJECT_ID_KEY = 'inbox_project_id'

/** The Inbox project id: a whole number above 0, or null (no entry, a reset, or a value that cannot be used). */
export function readInboxProjectId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** The global task order; anything that is not a known order reads as the default. */
export function readTaskOrderPref(value: unknown): TaskOrderKey {
  return parseTaskOrder(value)
}

/** The local date the last weekly review was finished (section 14.7): `"YYYY-MM-DD"`. */
export const WEEKLY_REVIEW_LAST_KEY = 'weekly_review.last'

/** A real local date `YYYY-MM-DD`, else null (never done, or a value that cannot be read). */
export function readWeeklyReviewLast(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null
}

// A project drawn without its folder icon (section 11.3): `project_icon.<id>` is "none"; no entry
// is the folder, and any other value acts as the folder and is kept.

export const PROJECT_ICON_KEY_PREFIX = 'project_icon.'
/** The icon value of a project, and the icon key of a custom list, drawn without an icon. */
export const ICON_NONE = 'none'

export function projectIconKey(projectId: number): string {
  return `${PROJECT_ICON_KEY_PREFIX}${projectId}`
}

/** The project id of a `project_icon.<id>` key (above 0), or null. */
export function projectIdOfIconKey(key: string): number | null {
  const match = /^project_icon\.([1-9]\d*)$/.exec(key)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) ? id : null
}

/** The projects whose synced icon is "none". */
export function projectsWithoutIcon(values: Readonly<Record<string, unknown>>): Set<number> {
  const ids = new Set<number>()
  for (const [key, value] of Object.entries(values)) {
    const id = projectIdOfIconKey(key)
    if (id !== null && value === ICON_NONE) ids.add(id)
  }
  return ids
}

// Places and location reminders (section 11.7): a place's id and name, and a task's reminder at
// it. Where a place is never syncs; only phones know it, and only phones remind.

export const PLACE_KEY_PREFIX = 'place.'
export const LOCATION_REMINDER_KEY_PREFIX = 'location_reminder.'
export const LOCATION_RADIUS_MIN = 100
export const LOCATION_RADIUS_MAX = 1000
export const LOCATION_RADIUS_OPTIONS = [100, 200, 500] as const
export const DEFAULT_LOCATION_RADIUS = 200

const PLACE_ID = /^[A-Za-z0-9_-]{1,64}$/

export type LocationTrigger = 'arrive' | 'leave'

export interface PlacePref {
  name: string
}

export interface LocationReminderPref {
  place: string
  trigger: LocationTrigger
  radius_m: number
}

export interface SyncedPlace {
  id: string
  name: string
}

export function placeKey(placeId: string): string {
  return `${PLACE_KEY_PREFIX}${placeId}`
}

export function locationReminderKey(taskId: number): string {
  return `${LOCATION_REMINDER_KEY_PREFIX}${taskId}`
}

export function isPlaceId(id: unknown): id is string {
  return typeof id === 'string' && PLACE_ID.test(id)
}

/** The place id of a `place.<id>` key, or null. */
export function placeIdOfKey(key: string): string | null {
  if (!key.startsWith(PLACE_KEY_PREFIX)) return null
  const id = key.slice(PLACE_KEY_PREFIX.length)
  return isPlaceId(id) ? id : null
}

/** The task id of a `location_reminder.<id>` key (a server id, above 0), or null. */
export function taskIdOfLocationReminderKey(key: string): number | null {
  if (!key.startsWith(LOCATION_REMINDER_KEY_PREFIX)) return null
  const raw = key.slice(LOCATION_REMINDER_KEY_PREFIX.length)
  if (!/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** A place value: `{ name }` with a name that is not blank, or null. Unknown fields are left out. */
export function readPlacePref(value: unknown): PlacePref | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' && name.trim() !== '' ? { name } : null
}

/** A reminder value with a place id, arrive or leave, and a whole radius of 100 to 1000 m, or null. */
export function readLocationReminderPref(value: unknown): LocationReminderPref | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { place, trigger, radius_m: radius } = value as Record<string, unknown>
  if (!isPlaceId(place)) return null
  if (trigger !== 'arrive' && trigger !== 'leave') return null
  if (typeof radius !== 'number' || !Number.isInteger(radius) || radius < LOCATION_RADIUS_MIN || radius > LOCATION_RADIUS_MAX) {
    return null
  }
  return { place, trigger, radius_m: radius }
}

/** The places in the entries' values (deleted and malformed ones left out), by name. */
export function readSyncedPlaces(values: Readonly<Record<string, unknown>>): SyncedPlace[] {
  const places: SyncedPlace[] = []
  for (const [key, value] of Object.entries(values)) {
    const id = placeIdOfKey(key)
    const place = id ? readPlacePref(value) : null
    if (id && place) places.push({ id, name: place.name })
  }
  return places.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

/** "Arrive: Home" or "Leave: Work". */
export function locationReminderLabel(trigger: LocationTrigger, placeName: string): string {
  return trigger === 'arrive' ? `Arrive: ${placeName}` : `Leave: ${placeName}`
}

// Shared routines, per person (section 6.9): this account's reminders of a routine someone shared,
// and whether it is hidden here. Never part of the routine itself.

export const ROUTINE_REMINDERS_KEY_PREFIX = 'routine_reminders.'
export const ROUTINE_HIDDEN_KEY_PREFIX = 'routine_hidden.'

const ROUTINE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function routineRemindersKey(routineId: string): string {
  return `${ROUTINE_REMINDERS_KEY_PREFIX}${routineId}`
}

export function routineHiddenKey(routineId: string): string {
  return `${ROUTINE_HIDDEN_KEY_PREFIX}${routineId}`
}

/** The routine id of a `routine_reminders.<id>` or `routine_hidden.<id>` key, or null. */
export function routineIdOfKey(key: string, prefix: typeof ROUTINE_REMINDERS_KEY_PREFIX | typeof ROUTINE_HIDDEN_KEY_PREFIX): string | null {
  if (!key.startsWith(prefix)) return null
  const id = key.slice(prefix.length)
  return ROUTINE_ID.test(id) ? id : null
}

/** False when this account turned the reminders of that shared routine off (`"off"`); any other value is the default, on. */
export function routineRemindersOn(values: Readonly<Record<string, unknown>>, routineId: string): boolean {
  return values[routineRemindersKey(routineId)] !== 'off'
}

/** True when this account hid that shared routine (`true`); any other value is the default, shown. */
export function routineHidden(values: Readonly<Record<string, unknown>>, routineId: string): boolean {
  return values[routineHiddenKey(routineId)] === true
}

/** The routines this account hid, by id. */
export function hiddenRoutineIds(values: Readonly<Record<string, unknown>>): string[] {
  return Object.entries(values).flatMap(([key, value]) => {
    const id = routineIdOfKey(key, ROUTINE_HIDDEN_KEY_PREFIX)
    return id && value === true ? [id] : []
  })
}

/**
 * The value an app uses for `key`, given the entries' values (absent, `null`, an unknown value or a
 * wrong type read as the default). A per-project order reads as null when it has no entry, which
 * means "follow the parent" (see `resolveTaskOrder`). A key this version does not know is undefined.
 */
export function readSyncedPref(values: Readonly<Record<string, unknown>>, key: string): unknown {
  const value = values[key]
  if (key === INBOX_PROJECT_ID_KEY) return readInboxProjectId(value)
  if (key === GLOBAL_TASK_ORDER_KEY) return readTaskOrderPref(value)
  if (key === WEEKLY_REVIEW_LAST_KEY) return readWeeklyReviewLast(value)
  if (/^task_order\.project\.\d+$/.test(key)) return value === undefined || value === null ? null : parseTaskOrder(value)
  if (placeIdOfKey(key) !== null) return readPlacePref(value)
  if (taskIdOfLocationReminderKey(key) !== null) return readLocationReminderPref(value)
  if (key.startsWith(PLACE_KEY_PREFIX) || key.startsWith(LOCATION_REMINDER_KEY_PREFIX)) return null
  if (routineIdOfKey(key, ROUTINE_REMINDERS_KEY_PREFIX) !== null) return value === 'off' ? 'off' : null
  if (routineIdOfKey(key, ROUTINE_HIDDEN_KEY_PREFIX) !== null) return value === true
  // Project categories (section 13): a category, and the category a top-level project is in.
  if (key.startsWith(PROJECT_CATEGORY_KEY_PREFIX)) return projectIdOfCategoryKey(key) !== null ? readProjectCategoryPref(value) : null
  if (key.startsWith(CATEGORY_KEY_PREFIX)) return categoryIdOfKey(key) !== null ? readCategoryPref(value) : null
  return undefined
}

/**
 * The one-time move of a setting the device kept before it synced (section 11.5): after the first
 * successful read of the carrier, the local value is written as an entry only when it differs from
 * the default and the carrier has no entry for the key (a `null` entry counts as one). The Inbox has
 * no default, so any usable local Inbox moves.
 */
export function shouldMoveLocalPref(key: string, localValue: unknown, carrierHasEntry: boolean): boolean {
  if (carrierHasEntry) return false
  if (key === INBOX_PROJECT_ID_KEY) return readInboxProjectId(localValue) !== null
  if (key === GLOBAL_TASK_ORDER_KEY) return parseTaskOrder(localValue) === localValue && localValue !== DEFAULT_TASK_ORDER
  return false
}
