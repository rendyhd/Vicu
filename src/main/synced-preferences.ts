import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { searchTasksAt } from './api-client'
import { loadPrefsCarriers } from './carrier-service'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { onAccountDataCleared } from './known-user'
import { fetchCurrentUser } from './auth/user-info'
import { normalizeServerUrl } from './offline/owner'
import { createSyncedDocumentService, type SyncedDocumentCodec, type SyncedDocumentStatus } from './synced-document-service'
import { PREFS_CARRIER_SEARCH, PREFS_CARRIER_TITLE, encodePrefsEnvelope, hasPrefsMarker, parsePrefsEnvelope } from './synced-prefs-protocol'
import { canonicalJson, isOwnTask } from '../shared/hidden-tasks'
import {
  INBOX_PROJECT_ID_KEY,
  emptySyncedPrefs,
  hasSyncedPrefsEntries,
  mergeSyncedPrefs,
  pruneSyncedPrefs,
  readInboxProjectId,
  readLocationReminderPref,
  sameSyncedPrefs,
  setSyncedPref,
  shouldMoveLocalPref,
  syncedPrefValues,
  taskIdOfLocationReminderKey,
  routineIdOfKey,
  ROUTINE_HIDDEN_KEY_PREFIX,
  ROUTINE_REMINDERS_KEY_PREFIX,
  validateSyncedPrefs,
  readWeeklyReviewLast,
  WEEKLY_REVIEW_LAST_KEY,
  ICON_NONE,
  projectIdOfIconKey,
  type SyncedPrefsDocument,
  type SyncedPrefsSnapshot,
} from '../shared/synced-prefs'
import { GLOBAL_TASK_ORDER_KEY, isTaskOrderKey } from '../shared/task-order'
import { categoryIdOfKey, isCategoryId, projectIdOfCategoryKey, readCategoryPref } from '../shared/project-categories'

/**
 * The synced preferences (docs/cross-app-semantics-v1.md section 11): the settings that change
 * what a list shows, kept in one hidden carrier per account (`vicu-prefs:v1`, in the Inbox, made
 * only once an entry exists). The local copy is `synced_prefs_sync` in config.json; the windows
 * read the values through IPC and get `synced-prefs-changed` when they change.
 *
 * The Inbox is a synced entry: `config.inbox_project_id` stays the local cache every reader uses,
 * and follows the entry. The first successful read of the carrier moves the Inbox this device had
 * into the carrier when the carrier has none (section 11.5); otherwise the carrier's Inbox wins.
 */

type PrefsState = NonNullable<AppConfig['synced_prefs_sync']>

export type { SyncedPrefsSnapshot }

export const SYNCED_PREFS_CHANGED_CHANNEL = 'synced-prefs-changed'
export const SYNCED_PREFS_STATUS_CHANNEL = 'synced-prefs-sync-status'

function ensureState(config: AppConfig): PrefsState {
  const current = config.synced_prefs_sync
  if (current) {
    try {
      validateSyncedPrefs(current.document)
      if (!current.device_id) current.device_id = randomUUID()
      return current
    } catch {
      // A damaged local copy starts over empty: the carrier still holds what was synced, and the
      // move does not run again over it.
    }
  }
  config.synced_prefs_sync = {
    device_id: current?.device_id || randomUUID(),
    document: emptySyncedPrefs(),
    dirty: false,
    ...(current?.moved ? { moved: true } : {}),
  }
  return config.synced_prefs_sync
}

/** Puts the synced values the app keeps a local cache of into `config` (the Inbox). */
function applySyncedValues(config: AppConfig, document: SyncedPrefsDocument): void {
  const inbox = readInboxProjectId(document.entries[INBOX_PROJECT_ID_KEY]?.value)
  // A missing or reset entry leaves the local Inbox alone: the Inbox has no default.
  if (inbox !== null && inbox !== config.inbox_project_id) config.inbox_project_id = inbox
}

let lastBroadcast: string | null = null
let pendingAdoptedInbox: number | undefined

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch { /* window may close between enumeration and send */ }
  }
}

function snapshotOf(config: AppConfig): SyncedPrefsSnapshot {
  return {
    values: syncedPrefValues(ensureState(config).document),
    inboxProjectId: config.inbox_project_id,
  }
}

function rememberBaseline(config: AppConfig | null): void {
  if (lastBroadcast === null && config) lastBroadcast = canonicalJson(snapshotOf(config))
}

/** Tells the windows, only when the values or the Inbox changed since they were last told. */
function broadcast(config: AppConfig): void {
  const snapshot = snapshotOf(config)
  const json = canonicalJson(snapshot)
  if (json === lastBroadcast && pendingAdoptedInbox === undefined) return
  lastBroadcast = json
  const adoptedInbox = pendingAdoptedInbox
  pendingAdoptedInbox = undefined
  sendToWindows(SYNCED_PREFS_CHANGED_CHANNEL, adoptedInbox !== undefined ? { ...snapshot, adoptedInbox } : snapshot)
  // The Quick View reads the Inbox from the config.
  sendToWindows('viewer-config-changed', undefined)
}

const prefsCodec: SyncedDocumentCodec<SyncedPrefsDocument> = {
  isCarrier: (description) => hasPrefsMarker(description),
  parse(description) {
    const parsed = parsePrefsEnvelope(description)
    if (parsed.document) return { document: parsed.document }
    return { futureVersion: parsed.futureVersion, error: parsed.error }
  },
  encode: encodePrefsEnvelope,
  normalize: (document) => document,
  empty: () => emptySyncedPrefs(),
  merge: mergeSyncedPrefs,
  prune: pruneSyncedPrefs,
  same: sameSyncedPrefs,
  // Only once the document holds an entry: a device that never changed a synced setting never
  // creates a carrier (section 11.1).
  worthCreating: (document) => hasSyncedPrefsEntries(document),
}

/**
 * The one-time move (section 11.5), after the first successful read of the carrier: the settings
 * this device kept before they synced are written as entries when the carrier has none for them.
 * Today that is the Inbox (the desktop had no task-order setting before). Returns true when
 * something was written, so the carrier is written next.
 */
function moveLocalSettings(config: AppConfig, state: PrefsState, now: number): boolean {
  if (state.moved) return false
  let document = state.document
  let wrote = false
  const localInbox = config.inbox_project_id
  if (shouldMoveLocalPref(INBOX_PROJECT_ID_KEY, localInbox, INBOX_PROJECT_ID_KEY in document.entries)) {
    document = setSyncedPref(document, INBOX_PROJECT_ID_KEY, localInbox, state.device_id, now)
    wrote = true
  } else {
    const synced = readInboxProjectId(document.entries[INBOX_PROJECT_ID_KEY]?.value)
    // The account's Inbox replaces the one this device had: say so once.
    if (synced !== null && localInbox > 0 && synced !== localInbox) pendingAdoptedInbox = synced
  }
  state.document = document
  state.moved = true
  if (wrote) state.dirty = true
  applySyncedValues(config, document)
  saveConfig(config)
  broadcast(config)
  return wrote
}

const service = createSyncedDocumentService<SyncedPrefsDocument>({
  logTag: '[SyncedPrefs]',
  title: PREFS_CARRIER_TITLE,
  statusChannel: SYNCED_PREFS_STATUS_CHANNEL,
  stateKey: 'synced_prefs_sync',
  messages: {
    connect: 'Connect to Vikunja to sync preferences',
    accountChanged: 'Account changed during the preferences sync',
    retrying: 'Preferences changed during sync; retrying',
    malformed: 'A malformed preferences carrier was ignored; valid data was preserved',
    updateRequired: 'Update Vicu to sync preferences',
    verifyFailed: 'Cannot verify the preferences carrier',
    chooseInbox: 'Choose an Inbox project before syncing preferences',
    failed: 'Preferences sync failed',
  },
  codec: prefsCodec,
  ensureState,
  // Before the move the local Inbox stays as it is: the move decides between it and the carrier's.
  afterPersist: (config, state) => {
    if ((state as PrefsState).moved) applySyncedValues(config, state.document)
  },
  changed: broadcast,
  beforeChange: rememberBaseline,
  loadCarriers: () => loadPrefsCarriers(),
  afterSync: (config, state) => moveLocalSettings(config, state as PrefsState, Date.now()),
})

// Another user of this server signed in and the previous user's settings and Inbox were cleared.
onAccountDataCleared(() => {
  const config = loadConfig()
  if (config) broadcast(config)
})

export function syncSyncedPrefs(): Promise<SyncedDocumentStatus> {
  return service.sync()
}

export function getSyncedPrefsStatus(): SyncedDocumentStatus {
  return service.status()
}

/** Synced settings changed here that have not reached the server yet. */
export function hasUnsyncedPreferenceChanges(): boolean {
  return service.hasUnsyncedChanges()
}

/**
 * Drops them: the settings go back to what the server last held (the Inbox too, once it follows the
 * synced entry) and are read again. The one-time move (section 11.5) does not run again.
 */
export function discardUnsyncedPreferenceChanges(): boolean {
  return service.discardUnsynced()
}

/** The values the windows use, and the Inbox. */
export function getSyncedPrefs(): SyncedPrefsSnapshot {
  const config = loadConfig()
  if (!config) return { values: {}, inboxProjectId: 0 }
  rememberBaseline(config)
  return snapshotOf(config)
}

/** True for a key this version writes, with a value it may hold (`null` resets it to the default). */
export function isWritablePref(key: unknown, value: unknown): key is string {
  if (typeof key !== 'string') return false
  if (key === INBOX_PROJECT_ID_KEY) return readInboxProjectId(value) !== null
  if (key === GLOBAL_TASK_ORDER_KEY || /^task_order\.project\.[1-9]\d*$/.test(key)) return value === null || isTaskOrderKey(value)
  // The day the last weekly review was finished (section 14.7).
  if (key === WEEKLY_REVIEW_LAST_KEY) return value === null || readWeeklyReviewLast(value) !== null
  // A task's location reminder at a place a phone saved (section 11.7). The desktop never creates,
  // renames or deletes a place: that needs its position, which only the phone has.
  if (taskIdOfLocationReminderKey(key) !== null) {
    if (value === null) return true
    const reminder = readLocationReminderPref(value)
    return reminder !== null && canonicalJson(reminder) === canonicalJson(value)
  }
  // A project drawn without its folder icon (section 11.3).
  if (projectIdOfIconKey(key) !== null) return value === null || value === ICON_NONE
  // A shared routine's reminders turned off, or the routine hidden, on this account (section 6.9).
  if (routineIdOfKey(key, ROUTINE_REMINDERS_KEY_PREFIX) !== null) return value === null || value === 'off'
  if (routineIdOfKey(key, ROUTINE_HIDDEN_KEY_PREFIX) !== null) return value === null || value === true
  // Project categories (section 13): a category's name and order (other fields a newer app wrote
  // are kept with it), and the category a top-level project is in.
  if (categoryIdOfKey(key) !== null) return value === null || readCategoryPref(value) !== null
  if (projectIdOfCategoryKey(key) !== null) return value === null || isCategoryId(value)
  return false
}

/**
 * A choice the user made: the entry is written locally at once, marked unsynced, and synced. A
 * value equal to the entry's is not written again. Returns the new snapshot.
 */
export function setSyncedPreference(key: string, value: unknown): SyncedPrefsSnapshot {
  if (!isWritablePref(key, value)) throw new Error(`Invalid synced preference ${String(key)}`)
  const current = loadConfig()
  if (!current) throw new Error('Configuration not loaded')
  const entry = ensureState(current).document.entries[key]
  if (entry && canonicalJson(entry.value ?? null) === canonicalJson(value)) return snapshotOf(current)
  const config = service.mutate((document, deviceId) => setSyncedPref(document, key, value, deviceId, Date.now()))
  return snapshotOf(config)
}

/**
 * Several choices made together (a category deleted with its projects' entries, categories
 * renumbered, an undo): one change of the local copy and one sync. Nothing is written unless every
 * key may hold its value; values equal to the entry's are left alone. Returns the new snapshot.
 */
export function setSyncedPreferences(values: Record<string, unknown>): SyncedPrefsSnapshot {
  const entries = Object.entries(values)
  for (const [key, value] of entries) {
    if (!isWritablePref(key, value)) throw new Error(`Invalid synced preference ${String(key)}`)
  }
  const current = loadConfig()
  if (!current) throw new Error('Configuration not loaded')
  const existing = ensureState(current).document.entries
  const changed = entries.filter(([key, value]) => {
    const entry = existing[key]
    return !entry || canonicalJson(entry.value ?? null) !== canonicalJson(value)
  })
  if (changed.length === 0) return snapshotOf(current)
  const now = Date.now()
  const config = service.mutate((document, deviceId) =>
    changed.reduce((next, [key, value]) => setSyncedPref(next, key, value, deviceId, now), document))
  return snapshotOf(config)
}

// --- Setup --------------------------------------------------------------------------------

/** What setup read for a server, so choosing that same Inbox does not write it again. */
let setupRead: { server: string; inboxProjectId: number | null } | null = null

export interface SetupPreferences {
  /** The account's synced Inbox, or null when it has none (or it could not be read). */
  inboxProjectId: number | null
  /** Vikunja's default project from `GET user`, a suggestion when there is no synced Inbox. */
  defaultProjectId: number | null
}

/**
 * Setup reads the preferences carrier before it asks for the Inbox (section 11.4), with the
 * server and token it is signing in with (the connection is not saved yet for an API token).
 * Read only; anything that fails reads as "nothing synced".
 */
export async function readSetupPreferences(url: string, token: string): Promise<SetupPreferences> {
  const server = url.replace(/\/+$/, '')
  setupRead = null
  const user = token ? await fetchCurrentUser(server, token) : null
  if (!user) return { inboxProjectId: null, defaultProjectId: null }
  const defaultProjectId = user.default_project_id ?? null
  const found = await searchTasksAt(server, token, PREFS_CARRIER_SEARCH)
  if (!found.success) return { inboxProjectId: null, defaultProjectId }
  let merged: SyncedPrefsDocument | null = null
  for (const raw of found.data) {
    const task = raw as { id?: number; description?: string; created_by?: { id?: unknown } | null } | null
    if (!task || typeof task.id !== 'number' || !isOwnTask(task, user.id)) continue
    const parsed = parsePrefsEnvelope(task.description)
    if (parsed.document) merged = merged ? mergeSyncedPrefs(merged, parsed.document) : parsed.document
  }
  const inboxProjectId = merged ? readInboxProjectId(merged.entries[INBOX_PROJECT_ID_KEY]?.value) : null
  setupRead = { server: normalizeServerUrl(server), inboxProjectId }
  return { inboxProjectId, defaultProjectId }
}

/**
 * Setup saved its Inbox: a device without an entry writes the answer (section 11.4). When the
 * answer is the synced Inbox setup just read, nothing is written; the next sync brings the entry.
 */
export function inboxChosenAtSetup(serverUrl: string, inboxProjectId: number | undefined): void {
  if (!inboxProjectId || inboxProjectId <= 0) return
  const read = setupRead
  setupRead = null
  if (read && read.server === normalizeServerUrl(serverUrl) && read.inboxProjectId === inboxProjectId) {
    void syncSyncedPrefs()
    return
  }
  setSyncedPreference(INBOX_PROJECT_ID_KEY, inboxProjectId)
}

/** For tests: forget what was announced and read at setup. */
export function resetSyncedPrefsForTests(): void {
  lastBroadcast = null
  pendingAdoptedInbox = undefined
  setupRead = null
}
