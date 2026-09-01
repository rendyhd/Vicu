import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createTask, fetchTaskById, fetchTasks, updateTask } from './api-client'
import { loadConfig, saveConfig, type AppConfig } from './config'
import {
  CUSTOM_LIST_CARRIER_TITLE,
  activeLists,
  documentFromLists,
  encodeCustomListEnvelope,
  hasCustomListMarker,
  mergeCustomListDocuments,
  nextRevision,
  normalizeDocument,
  normalizeWireList,
  parseCustomListEnvelope,
  validateCustomListDocument,
  type CustomListSyncDocumentV1,
  type CustomListWire,
} from './custom-list-protocol'

const NULL_DATE = '0001-01-01T00:00:00Z'

export type CustomListSyncStatus =
  | { state: 'idle'; last_synced_at?: string }
  | { state: 'syncing' }
  | { state: 'pending'; message?: string }
  | { state: 'offline'; message: string }
  | { state: 'error'; message: string }
  | { state: 'update_required'; message: string }
  | { state: 'local_only' }

interface CarrierTask {
  id: number
  title?: string
  description?: string
  done?: boolean
}

let syncStatus: CustomListSyncStatus = { state: 'idle' }
let inFlightSync: Promise<CustomListSyncStatus> | null = null

function appListToWire(list: NonNullable<AppConfig['custom_lists']>[number]): CustomListWire {
  return normalizeWireList({
    id: list.id,
    name: list.name,
    icon: list.icon ?? '',
    filter: {
      project_ids: list.filter.project_ids ?? [],
      project_filter_mode: list.filter.project_filter_mode ?? 'include',
      add_to_project_id: list.filter.add_to_project_id ?? 0,
      sort_by: list.filter.sort_by || 'due_date',
      order_by: list.filter.order_by || 'asc',
      due_date_filter: list.filter.due_date_filter || 'all',
      priority_filter: list.filter.priority_filter ?? [],
      label_ids: list.filter.label_ids ?? [],
      include_done: list.filter.include_done === true,
      include_today_all_projects: list.filter.include_today_all_projects === true,
    },
  })
}

function wireToAppList(list: CustomListWire): NonNullable<AppConfig['custom_lists']>[number] {
  return {
    id: list.id,
    name: list.name,
    ...(list.icon ? { icon: list.icon } : {}),
    filter: {
      project_ids: list.filter.project_ids,
      project_filter_mode: list.filter.project_filter_mode,
      add_to_project_id: list.filter.add_to_project_id,
      sort_by: list.filter.sort_by,
      order_by: list.filter.order_by,
      due_date_filter: list.filter.due_date_filter,
      ...(list.filter.priority_filter.length ? { priority_filter: list.filter.priority_filter } : {}),
      ...(list.filter.label_ids.length ? { label_ids: list.filter.label_ids } : {}),
      include_done: list.filter.include_done,
      include_today_all_projects: list.filter.include_today_all_projects,
    },
  }
}

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

function broadcastLists(config = loadConfig()): void {
  const lists = config?.custom_lists ?? []
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send('custom-lists-changed', lists)
      win.webContents.send('custom-list-sync-status', syncStatus)
      win.webContents.send('viewer-config-changed')
    } catch { /* window may close between enumeration and send */ }
  }
}

function setStatus(status: CustomListSyncStatus): CustomListSyncStatus {
  syncStatus = status
  broadcastLists()
  return status
}

export function getCustomListSyncStatus(): CustomListSyncStatus {
  const config = loadConfig()
  if (config?.standalone_mode) return { state: 'local_only' }
  if (config?.custom_lists_sync?.dirty && syncStatus.state === 'idle') return { state: 'pending' }
  return syncStatus
}

export function getCustomLists(): NonNullable<AppConfig['custom_lists']> {
  const config = loadConfig()
  if (!config) return []
  const hadState = !!config.custom_lists_sync
  const state = ensureSyncState(config)
  config.custom_lists = activeLists(state.document).map(wireToAppList)
  if (!hadState) saveConfig(config)
  return config.custom_lists
}

function saveLocalMutation(config: AppConfig, document: CustomListSyncDocumentV1): NonNullable<AppConfig['custom_lists']> {
  persist(config, document, true)
  setStatus(config.standalone_mode ? { state: 'local_only' } : { state: 'pending' })
  broadcastLists(config)
  if (!config.standalone_mode) void syncCustomLists()
  return config.custom_lists ?? []
}

export function upsertCustomList(value: CustomListWire): NonNullable<AppConfig['custom_lists']> {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
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

export function deleteCustomList(id: string): NonNullable<AppConfig['custom_lists']> {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
  const state = ensureSyncState(config)
  const document = normalizeDocument(state.document)
  document.lists[id] = { value: null, revision: nextRevision(document, state.device_id) }
  document.order = {
    ids: document.order.ids.filter((entry) => entry !== id),
    revision: nextRevision(document, state.device_id),
  }
  return saveLocalMutation(config, document)
}

export function reorderCustomLists(ids: string[]): NonNullable<AppConfig['custom_lists']> {
  const config = loadConfig()
  if (!config) throw new Error('Configuration not loaded')
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
  const result = await fetchTasks({ filter: 'done = true', sort_by: 'updated', order_by: 'desc', per_page: 200 })
  if (!result.success) throw new Error(result.error)
  const valid: Array<{ task: CarrierTask; document: CustomListSyncDocumentV1 }> = []
  let malformed = 0
  let futureVersion: number | undefined
  for (const raw of result.data) {
    const task = raw as CarrierTask
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

async function createCarrier(projectId: number, document: CustomListSyncDocumentV1): Promise<number> {
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
  await writeCarrier(task.id, document)
  return task.id
}

function looksOffline(message: string): boolean {
  return /offline|network|connect|timed?\s*out|ENOTFOUND|ECONN|ERR_/i.test(message)
}

async function runSync(): Promise<CustomListSyncStatus> {
  let config = loadConfig()
  if (!config) return setStatus({ state: 'error', message: 'Configuration not loaded' })
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
    persist(config, merged, hadPendingLocalChanges)
    broadcastLists(config)

    const canonical = carriers.valid.map((entry) => entry.task).sort((a, b) => a.id - b.id)[0]
    let carrierId = canonical?.id
    const canonicalDocument = carriers.valid.find((entry) => entry.task.id === canonical?.id)?.document
    const needsWrite = canonicalDocument
      ? !documentsEqual(canonicalDocument, merged)
      : Object.keys(merged.lists).length > 0 || hadPendingLocalChanges

    if (needsWrite) {
      if (carrierId) await writeCarrier(carrierId, merged)
      else {
        if (!config.inbox_project_id) throw new Error('Choose an Inbox project before syncing custom lists')
        carrierId = await createCarrier(config.inbox_project_id, merged)
      }
    }

    if (carrierId) {
      const verified = await fetchTaskById(carrierId)
      if (!verified.success) throw new Error(verified.error)
      const parsed = parseCustomListEnvelope((verified.data as CarrierTask).description)
      if (!parsed.document) throw new Error(parsed.error || 'Cannot verify custom-list carrier')
      const latest = loadConfig() ?? config
      if (latest.vikunja_url.replace(/\/+$/, '') !== syncUrl) {
        return setStatus({ state: 'pending', message: 'Account changed during custom-list sync' })
      }
      // Include edits made while the write/verification request was in flight. If the
      // carrier does not contain them yet, keep the merged local document dirty.
      const latestLocalDocument = ensureSyncState(latest).document
      const converged = mergeCustomListDocuments(
        mergeCustomListDocuments(merged, parsed.document),
        latestLocalDocument,
      )
      if (!documentsEqual(converged, parsed.document)) {
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
