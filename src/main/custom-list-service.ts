import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { loadCustomListCarriers } from './carrier-service'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { onAccountDataCleared } from './known-user'
import {
  CUSTOM_LIST_CARRIER_TITLE,
  activeLists,
  appListToWire,
  documentFromLists,
  dropDuplicateImports,
  duplicateImports,
  emptyCustomListDocument,
  encodeCustomListEnvelope,
  hasCustomListMarker,
  mergeCustomListDocuments,
  nextRevision,
  normalizeDocument,
  normalizeWireList,
  parseCustomListEnvelope,
  pruneTombstones,
  unionImported,
  validateCustomListDocument,
  wireToAppList,
  type CustomList,
  type CustomListSyncDocumentV1,
  type CustomListWire,
} from './custom-list-protocol'
import { createSyncedDocumentService, type SyncedDocumentCodec } from './synced-document-service'
import type { CustomListSyncStatus } from '../shared/config-types'

export type { CustomListSyncStatus }

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

/** The custom-list document rules (custom-list-protocol.ts) for the synced-document loop. */
const customListCodec: SyncedDocumentCodec<CustomListSyncDocumentV1> = {
  isCarrier: (description) => hasCustomListMarker(description),
  parse(description) {
    const parsed = parseCustomListEnvelope(description)
    if (parsed.document) return { document: parsed.document }
    if (parsed.version && parsed.version > 1) return { futureVersion: parsed.version, error: parsed.error }
    return { error: parsed.error }
  },
  encode: encodeCustomListEnvelope,
  normalize: normalizeDocument,
  empty: emptyCustomListDocument,
  merge: mergeCustomListDocuments,
  prune: pruneTombstones,
  same: (left, right) => JSON.stringify(normalizeDocument(left)) === JSON.stringify(normalizeDocument(right)),
  // Created for a document that holds lists (or tombstones), or after a local change.
  worthCreating: (document, dirty) => Object.keys(document.lists).length > 0 || dirty,
}

const service = createSyncedDocumentService<CustomListSyncDocumentV1>({
  logTag: '[CustomLists]',
  title: CUSTOM_LIST_CARRIER_TITLE,
  statusChannel: 'custom-list-sync-status',
  stateKey: 'custom_lists_sync',
  messages: {
    connect: 'Connect to Vikunja to sync custom lists',
    accountChanged: 'Account changed during custom-list sync',
    retrying: 'Custom lists changed during sync; retrying',
    malformed: 'A malformed custom-list carrier was ignored; valid data was preserved',
    updateRequired: 'Update Vicu to sync custom lists',
    verifyFailed: 'Cannot verify custom-list carrier',
    chooseInbox: 'Choose an Inbox project before syncing custom lists',
    failed: 'Custom-list sync failed',
  },
  codec: customListCodec,
  ensureState: ensureSyncState,
  afterPersist: (config, state) => {
    config.custom_lists = activeLists(state.document).map(wireToAppList)
  },
  changed: (config) => broadcastLists(config),
  beforeChange: rememberBroadcastBaseline,
  loadCarriers: () => loadCustomListCarriers(),
})

// Another user of this server signed in and the previous user's lists were cleared: show that.
onAccountDataCleared(() => broadcastLists())

export function getCustomListSyncStatus(): CustomListSyncStatus {
  return service.status()
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

export function upsertCustomList(value: CustomListWire): CustomList[] {
  const config = service.mutate((document, deviceId) => {
    const normalized = normalizeWireList(value)
    const isNew = !document.lists[normalized.id]?.value
    document.lists[normalized.id] = { value: normalized, revision: nextRevision(document, deviceId) }
    if (isNew && !document.order.ids.includes(normalized.id)) {
      document.order = {
        ids: [...document.order.ids, normalized.id],
        revision: nextRevision(document, deviceId),
      }
    }
    return document
  })
  return config.custom_lists ?? []
}

export function deleteCustomList(id: string): CustomList[] {
  const config = service.mutate((document, deviceId) => {
    document.lists[id] = { value: null, revision: nextRevision(document, deviceId) }
    document.order = {
      ids: document.order.ids.filter((entry) => entry !== id),
      revision: nextRevision(document, deviceId),
    }
    return document
  })
  return config.custom_lists ?? []
}

export function reorderCustomLists(ids: string[]): CustomList[] {
  const config = service.mutate((document, deviceId) => {
    const activeIds = new Set(activeLists(document).map((list) => list.id))
    const requested = ids.filter((id, index) => activeIds.has(id) && ids.indexOf(id) === index)
    const missing = document.order.ids.filter((id) => activeIds.has(id) && !requested.includes(id))
    document.order = { ids: [...requested, ...missing], revision: nextRevision(document, deviceId) }
    return document
  })
  return config.custom_lists ?? []
}

/** Runs after every custom-list sync with its result (the saved-filter step, section 3.7). */
let afterSync: ((status: CustomListSyncStatus) => Promise<void>) | null = null

export function setAfterCustomListSync(step: (status: CustomListSyncStatus) => Promise<void>): void {
  afterSync = step
}

export async function syncCustomLists(): Promise<CustomListSyncStatus> {
  const status = await service.sync()
  if (afterSync) {
    try {
      await afterSync(status)
    } catch (error) {
      console.warn('[CustomLists] After-sync step failed:', error instanceof Error ? error.message : error)
    }
  }
  return service.status()
}

/** The saved filters any device imported (section 3.7), from the synced document. */
export function importedSavedFilterIds(): number[] {
  const config = loadConfig()
  if (!config) return []
  return config.custom_lists_sync?.document.imported_saved_filters ?? []
}

/**
 * Adds `lists` at the end and records `filterIds` as imported, in one change; the change syncs
 * at once. Lists without a name are skipped.
 */
export function importCustomLists(lists: CustomListWire[], filterIds: number[]): CustomList[] {
  if (lists.length === 0 && filterIds.length === 0) return getCustomLists()
  const config = service.mutate((document, deviceId) => {
    for (const value of lists) {
      const normalized = normalizeWireList(value)
      document.lists[normalized.id] = { value: normalized, revision: nextRevision(document, deviceId) }
    }
    const added = lists.map((list) => list.id).filter((id) => !document.order.ids.includes(id))
    if (added.length > 0) {
      document.order = { ids: [...document.order.ids, ...added], revision: nextRevision(document, deviceId) }
    }
    const imported = unionImported(document.imported_saved_filters, filterIds)
    if (imported) document.imported_saved_filters = imported
    return document
  })
  return config.custom_lists ?? []
}

/** Turns lists that repeat another list's saved filter into tombstones; false when there were none. */
export function dropDuplicateCustomListImports(): boolean {
  const config = loadConfig()
  if (!config?.custom_lists_sync || duplicateImports(config.custom_lists_sync.document).length === 0) return false
  service.mutate((document, deviceId) => dropDuplicateImports(document, deviceId))
  return true
}

/** Custom-list changes made here that have not reached the server yet. */
export function hasUnsyncedCustomListChanges(): boolean {
  return service.hasUnsyncedChanges()
}

/** Drops them: the lists go back to what the server last held and are read again. */
export function discardUnsyncedCustomListChanges(): boolean {
  return service.discardUnsynced()
}
