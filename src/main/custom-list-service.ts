import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createTask, deleteTask, fetchTaskById, updateTask } from './api-client'
import { forgetDeletedTask, loadCustomListCarriers, rememberCreatedTask } from './carrier-service'
import { loadConfig, saveConfig, type AppConfig } from './config'
import {
  CUSTOM_LIST_CARRIER_TITLE,
  activeLists,
  appListToWire,
  documentFromLists,
  encodeCustomListEnvelope,
  hasCustomListMarker,
  mergeCustomListDocuments,
  nextRevision,
  normalizeDocument,
  normalizeWireList,
  parseCustomListEnvelope,
  pruneTombstones,
  validateCustomListDocument,
  wireToAppList,
  type CustomList,
  type CustomListSyncDocumentV1,
  type CustomListWire,
} from './custom-list-protocol'
import type { CustomListSyncStatus } from '../shared/config-types'

export type { CustomListSyncStatus }

const NULL_DATE = '0001-01-01T00:00:00Z'

interface CarrierTask {
  id: number
  title?: string
  description?: string
  done?: boolean
}

let syncStatus: CustomListSyncStatus = { state: 'idle' }
let inFlightSync: Promise<CustomListSyncStatus> | null = null
// The lists as the windows were last told about them (JSON), so the viewer is only told when
// they really changed.
let lastBroadcastLists: string | null = null

function ensureSyncState(config: AppConfig): NonNullable<AppConfig['custom_lists_sync']> {
  const current = config.custom_lists_sync
  if (current) {
    try {
      validateCustomListDocument(current.document)
      current.document = normalizeDocument(current.document)
      return current
    } catch {
      // Corrupt local sync metadata must not make the user's visible local
      // lists inaccessible. Rebuild metadata from that lossless cache.
    }
  }
  const deviceId = current?.device_id || randomUUID()
  const document = documentFromLists((config.custom_lists ?? []).map(appListToWire), deviceId)
  config.custom_lists_sync = { device_id: deviceId, document, dirty: (config.custom_lists?.length ?? 0) > 0 }
  return config.custom_lists_sync
}

function persist(config: AppConfig, document: CustomListSyncDocumentV1, dirty: boolean): void {
  const state = ensureSyncState(config)
  state.document = normalizeDocument(document)
  state.dirty = dirty
  config.custom_lists = activeLists(state.document).map(wireToAppList)
  saveConfig(config)
}

function sendToWindows(send: (win: BrowserWindow) => void): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      send(win)
    } catch { /* window may close between enumeration and send */ }
  }
}

/** What the windows currently show is what the config holds; call before the lists can change. */
function rememberBroadcastBaseline(config: AppConfig | null): void {
  if (lastBroadcastLists === null) lastBroadcastLists = JSON.stringify(config?.custom_lists ?? [])
}

/**
 * Tells the windows the lists changed, and the Quick View to drop its cached tasks, but only when
 * they differ from what was last announced. Every sync step used to send this, so Quick View
 * dropped its cache every five minutes for nothing (D-CL-1).
 */
function broadcastLists(config = loadConfig()): void {
  const lists = config?.custom_lists ?? []
  const snapshot = JSON.stringify(lists)
  if (snapshot === lastBroadcastLists) return
  lastBroadcastLists = snapshot
  sendToWindows((win) => {
    win.webContents.send('custom-lists-changed', lists)
    win.webContents.send('viewer-config-changed')
  })
}

function setStatus(status: CustomListSyncStatus): CustomListSyncStatus {
  syncStatus = status
  sendToWindows((win) => win.webContents.send('custom-list-sync-status', syncStatus))
  return status
}

export function getCustomListSyncStatus(): CustomListSyncStatus {
  const config = loadConfig()
  if (config?.standalone_mode) return { state: 'local_only' }
  if (config?.custom_lists_sync?.dirty && syncStatus.state === 'idle') return { state: 'pending' }
  return syncStatus
}

export function getCustomLists(): CustomList[] {
  const config = loadConfig()
  if (!config) return []
  rememberBroadcastBaseline(config)
  const hadState = !!config.custom_lists_sync
  const state = ensureSyncState(config)
  config.custom_lists = activeLists(state.document).map(wireToAppList)
  if (!hadState) saveConfig(config)
  return config.custom_lists
}

function saveLocalMutation(config: AppConfig, document: CustomListSyncDocumentV1): CustomList[] {
  persist(config, document, true)
  setStatus(config.standalone_mode ? { state: 'local_only' } : { state: 'pending' })
  broadcastLists(config)
  if (!config.standalone_mode) void syncCustomLists()
  return config.custom_lists ?? []
}

export function upsertCustomList(value: CustomListWire): CustomList[] {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
  rememberBroadcastBaseline(config)
  const state = ensureSyncState(config)
  const document = normalizeDocument(state.document)
  const normalized = normalizeWireList(value)
  const isNew = !document.lists[normalized.id]?.value
  document.lists[normalized.id] = { value: normalized, revision: nextRevision(document, state.device_id) }
  if (isNew && !document.order.ids.includes(normalized.id)) {
    document.order = {
      ids: [...document.order.ids, normalized.id],
      revision: nextRevision(document, state.device_id),
    }
  }
  return saveLocalMutation(config, document)
}

export function deleteCustomList(id: string): CustomList[] {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
  rememberBroadcastBaseline(config)
  const state = ensureSyncState(config)
  const document = normalizeDocument(state.document)
  document.lists[id] = { value: null, revision: nextRevision(document, state.device_id) }
  document.order = {
    ids: document.order.ids.filter((entry) => entry !== id),
    revision: nextRevision(document, state.device_id),
  }
  return saveLocalMutation(config, document)
}

export function reorderCustomLists(ids: string[]): CustomList[] {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
  rememberBroadcastBaseline(config)
  const state = ensureSyncState(config)
  const document = normalizeDocument(state.document)
  const activeIds = new Set(activeLists(document).map((list) => list.id))
  const requested = ids.filter((id, index) => activeIds.has(id) && ids.indexOf(id) === index)
  const missing = document.order.ids.filter((id) => activeIds.has(id) && !requested.includes(id))
  document.order = { ids: [...requested, ...missing], revision: nextRevision(document, state.device_id) }
  return saveLocalMutation(config, document)
}

function documentsEqual(left: CustomListSyncDocumentV1, right: CustomListSyncDocumentV1): boolean {
  return JSON.stringify(normalizeDocument(left)) === JSON.stringify(normalizeDocument(right))
}

async function fetchCarriers(): Promise<{ valid: Array<{ task: CarrierTask; document: CustomListSyncDocumentV1 }>; malformed: number; futureVersion?: number }> {
  // The carriers this app has seen are fetched by id; new ones are found with a marker search
  // (see carrier-discovery.ts). The done tasks are no longer listed on every sync.
  const result = await loadCustomListCarriers()
  if (!result.success) throw new Error(result.error)
  const valid: Array<{ task: CarrierTask; document: CustomListSyncDocumentV1 }> = []
  let malformed = 0
  let futureVersion: number | undefined
  for (const task of result.data) {
    if (task.title !== CUSTOM_LIST_CARRIER_TITLE && !hasCustomListMarker(task.description)) continue
    const parsed = parseCustomListEnvelope(task.description)
    if (parsed.document) valid.push({ task, document: parsed.document })
    else if (parsed.version && parsed.version > 1) futureVersion = Math.max(futureVersion ?? 0, parsed.version)
    else malformed += 1
  }
  return { valid, malformed, futureVersion }
}

async function writeCarrier(taskId: number, document: CustomListSyncDocumentV1): Promise<void> {
  const result = await updateTask(taskId, {
    title: CUSTOM_LIST_CARRIER_TITLE,
    description: encodeCustomListEnvelope(document),
    done: true,
    due_date: NULL_DATE,
    repeat_after: 0,
    repeat_mode: 0,
    reminders: [],
  })
  if (!result.success) throw new Error(result.error)
}

/**
 * Creates the carrier already completed, in one request. Only a server that ignored `done` on
 * create (it would leave an open, visible carrier) gets a second one to finish it.
 */
async function createCarrier(projectId: number, document: CustomListSyncDocumentV1): Promise<{ id: number; description?: string }> {
  const created = await createTask(projectId, {
    title: CUSTOM_LIST_CARRIER_TITLE,
    description: encodeCustomListEnvelope(document),
    done: true,
    due_date: NULL_DATE,
    repeat_after: 0,
    repeat_mode: 0,
    reminders: [],
  })
  if (!created.success) throw new Error(created.error)
  const task = created.data as CarrierTask
  rememberCreatedTask(task)
  if (task.done !== true) {
    await writeCarrier(task.id, document)
    return { id: task.id }
  }
  // The create response is the stored task: it is the read-back, no extra request needed.
  return { id: task.id, description: task.description }
}

/**
 * Deletes carriers that were created next to the one this app keeps (two devices that first
 * synced at the same time each made one). `kept` is what the kept carrier holds after a
 * successful write and read-back. An extra is read again right before it goes and is only deleted
 * when the kept carrier already holds everything in it (old tombstones aside), so a list another
 * device just wrote there is merged first, on the next sync. Carriers that cannot be read are never touched.
 */
async function removeDuplicateCarriers(
  extras: Array<{ task: CarrierTask; document: CustomListSyncDocumentV1 }>,
  kept: CustomListSyncDocumentV1,
): Promise<void> {
  for (const extra of extras) {
    try {
      const fresh = await fetchTaskById(extra.task.id)
      if (!fresh.success) {
        if (fresh.statusCode === 404) forgetDeletedTask(extra.task.id)
        continue
      }
      const parsed = parseCustomListEnvelope((fresh.data as CarrierTask).description)
      if (!parsed.document) continue
      // Tombstones older than 90 days are not kept in the kept carrier, so they do not count.
      if (!documentsEqual(pruneTombstones(mergeCustomListDocuments(kept, parsed.document)), kept)) continue
      const removed = await deleteTask(extra.task.id)
      if (removed.success) forgetDeletedTask(extra.task.id)
      else console.warn(`[CustomLists] Could not delete the duplicate carrier ${extra.task.id}: ${removed.error}`)
    } catch (error) {
      console.warn(`[CustomLists] Could not clean up the duplicate carrier ${extra.task.id}:`, error instanceof Error ? error.message : error)
    }
  }
}

function looksOffline(message: string): boolean {
  return /offline|network|connect|timed?\s*out|ENOTFOUND|ECONN|ERR_/i.test(message)
}

async function runSync(): Promise<CustomListSyncStatus> {
  let config = loadConfig()
  if (!config) return setStatus({ state: 'error', message: 'Configuration not loaded' })
  rememberBroadcastBaseline(config)
  if (config.standalone_mode) return setStatus({ state: 'local_only' })
  if (!config.vikunja_url) return setStatus({ state: 'pending', message: 'Connect to Vikunja to sync custom lists' })
  const syncUrl = config.vikunja_url.replace(/\/+$/, '')
  setStatus({ state: 'syncing' })

  try {
    const carriers = await fetchCarriers()
    if (carriers.futureVersion) {
      return setStatus({ state: 'update_required', message: 'Update Vicu to sync custom lists' })
    }
    // A local edit may have landed while the network read was in flight. Rebase the
    // merge on the newest main-owned document so that edit cannot be overwritten.
    const refreshedConfig = loadConfig()
    if (!refreshedConfig || refreshedConfig.vikunja_url.replace(/\/+$/, '') !== syncUrl) {
      return setStatus({ state: 'pending', message: 'Account changed during custom-list sync' })
    }
    config = refreshedConfig
    const state = ensureSyncState(config)
    const hadPendingLocalChanges = state.dirty

    let merged = normalizeDocument(state.document)
    for (const carrier of carriers.valid) merged = mergeCustomListDocuments(merged, carrier.document)
    // Tombstones older than 90 days are dropped here, so the document the carrier is written with
    // (and the local copy) stops growing. A carrier that still holds them counts as changed.
    merged = pruneTombstones(merged)
    persist(config, merged, hadPendingLocalChanges)
    broadcastLists(config)

    const canonical = carriers.valid.map((entry) => entry.task).sort((a, b) => a.id - b.id)[0]
    let carrierId = canonical?.id
    const canonicalDocument = carriers.valid.find((entry) => entry.task.id === canonical?.id)?.document
    const needsWrite = canonicalDocument
      ? !documentsEqual(canonicalDocument, merged)
      : Object.keys(merged.lists).length > 0 || hadPendingLocalChanges

    // What the carrier holds right now. Without a write that is what was just read; after a write
    // it is read back, so a server that altered the description is noticed.
    let verifiedDocument: CustomListSyncDocumentV1 | undefined = canonicalDocument
    if (needsWrite) {
      verifiedDocument = undefined
      if (carrierId) await writeCarrier(carrierId, merged)
      else {
        if (!config.inbox_project_id) throw new Error('Choose an Inbox project before syncing custom lists')
        const created = await createCarrier(config.inbox_project_id, merged)
        carrierId = created.id
        if (created.description !== undefined) verifiedDocument = parseCustomListEnvelope(created.description).document
      }
    }

    if (carrierId) {
      if (!verifiedDocument) {
        const verified = await fetchTaskById(carrierId)
        if (!verified.success) throw new Error(verified.error)
        const parsed = parseCustomListEnvelope((verified.data as CarrierTask).description)
        if (!parsed.document) throw new Error(parsed.error || 'Cannot verify custom-list carrier')
        verifiedDocument = parsed.document
      }
      const latest = loadConfig() ?? config
      if (latest.vikunja_url.replace(/\/+$/, '') !== syncUrl) {
        return setStatus({ state: 'pending', message: 'Account changed during custom-list sync' })
      }
      // Include edits made while the write/verification request was in flight. If the
      // carrier does not contain them yet, keep the merged local document dirty.
      const latestLocalDocument = ensureSyncState(latest).document
      const converged = mergeCustomListDocuments(
        mergeCustomListDocuments(merged, verifiedDocument),
        latestLocalDocument,
      )
      if (!documentsEqual(converged, verifiedDocument)) {
        persist(latest, converged, true)
        broadcastLists(latest)
        return setStatus({ state: 'pending', message: 'Custom lists changed during sync; retrying' })
      }
      merged = converged
      config = latest
    }

    const lastSyncedAt = new Date().toISOString()
    const latest = loadConfig() ?? config
    const latestState = ensureSyncState(latest)
    latestState.document = merged
    latestState.carrier_task_id = carrierId
    latestState.dirty = false
    latestState.last_synced_at = lastSyncedAt
    latest.custom_lists = activeLists(merged).map(wireToAppList)
    saveConfig(latest)
    broadcastLists(latest)
    // The oldest carrier now holds everything: the other carriers are only clutter in the user's
    // Vikunja, so remove them. Never part of the sync result; a failure is retried next time.
    if (carrierId) {
      await removeDuplicateCarriers(carriers.valid.filter((entry) => entry.task.id !== carrierId), merged)
    }
    if (carriers.malformed > 0) {
      return setStatus({ state: 'error', message: 'A malformed custom-list carrier was ignored; valid data was preserved' })
    }
    return setStatus({ state: 'idle', last_synced_at: lastSyncedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Custom-list sync failed'
    const latest = loadConfig()
    if (latest) {
      const latestState = ensureSyncState(latest)
      latestState.dirty = true
      saveConfig(latest)
    }
    return setStatus(looksOffline(message) ? { state: 'offline', message } : { state: 'error', message })
  }
}

export function syncCustomLists(): Promise<CustomListSyncStatus> {
  if (inFlightSync) return inFlightSync
  inFlightSync = runSync().finally(() => {
    inFlightSync = null
    const config = loadConfig()
    if (syncStatus.state === 'pending' && config?.vikunja_url && config.custom_lists_sync?.dirty) {
      setTimeout(() => { void syncCustomLists() }, 250)
    }
  })
  return inFlightSync
}
