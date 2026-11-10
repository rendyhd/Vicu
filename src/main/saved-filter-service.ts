/**
 * Vikunja saved filters as custom lists (docs/cross-app-semantics-v1.md, section 3.7). Android has
 * the same in `SavedFilterImporter.kt`.
 *
 * - The project read records the saved filters it finds (`recordKnownSavedFilters`).
 * - After the first custom-list sync that read the carrier on this version, every readable filter
 *   not imported yet is imported, once per device (`first_connect_done`).
 * - After that, Settings offers the filters that are new; Import saved filters is always there.
 * - The carrier's `imported_saved_filters` (a union) keeps two devices from importing one filter
 *   twice; a duplicate that slipped through is turned into a tombstone after each sync.
 *
 * An import is a copy: the saved filter on the server is never changed or deleted.
 */
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { fetchProjectsAndSavedFilters, fetchSavedFilter } from './api-client'
import { loadConfig, saveConfig, type AppConfig } from './config'
import {
  dropDuplicateCustomListImports,
  importCustomLists,
  importedSavedFilterIds,
  setAfterCustomListSync,
} from './custom-list-service'
import type { CustomListWire } from './custom-list-protocol'
import { onAccountDataCleared } from './known-user'
import {
  convertSavedFilter,
  savedFilterIdOf,
  type SavedFilterDto,
  type SavedFilterImportOutcome,
  type SavedFilterPreview,
  type SavedFilterRef,
  type SavedFilterState,
} from '../shared/saved-filter-import'
import type { CustomListSyncStatus } from '../shared/config-types'

type Store = NonNullable<AppConfig['saved_filters']>

function storeOf(config: AppConfig): Store {
  if (!config.saved_filters) config.saved_filters = { known: [] }
  return config.saved_filters
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch { /* window may close between enumeration and send */ }
  }
}

export function getSavedFilterState(): SavedFilterState {
  const config = loadConfig()
  const store = config?.saved_filters ?? { known: [] }
  const imported = importedSavedFilterIds()
  const dismissed = new Set(store.dismissed ?? [])
  return {
    known: store.known,
    offer: store.known.filter((filter) => !imported.includes(filter.id) && !dismissed.has(filter.id)),
    imported,
    notice_closed: store.notice_closed ?? [],
  }
}

/** Records the saved filters among the pseudo-projects a project read returned. */
export function recordKnownSavedFilters(pseudo: Array<{ id: number; title?: string }>): void {
  const config = loadConfig()
  if (!config) return
  const known: SavedFilterRef[] = pseudo
    .map((project) => ({ id: savedFilterIdOf(project.id), title: project.title ?? '' }))
    .filter((ref): ref is SavedFilterRef => ref.id !== null)
    .sort((a, b) => a.id - b.id)
  const store = storeOf(config)
  if (JSON.stringify(store.known) === JSON.stringify(known)) return
  store.known = known
  saveConfig(config)
  broadcast('saved-filters-changed', getSavedFilterState())
}

/** Reads the projects again for the saved filters; false when the server could not be asked. */
async function readKnown(): Promise<boolean> {
  const result = await fetchProjectsAndSavedFilters(true)
  if (!result.success) return false
  recordKnownSavedFilters(result.data.pseudo)
  return true
}

/** The import dialog's rows for `ids` (every known filter when absent); null when a read failed. */
export async function previewSavedFilters(ids?: number[]): Promise<SavedFilterPreview[] | null> {
  const state = getSavedFilterState()
  const wanted = ids ? state.known.filter((filter) => ids.includes(filter.id)) : state.known
  const previews: SavedFilterPreview[] = []
  for (const filter of wanted) {
    const result = await fetchSavedFilter(filter.id)
    if (!result.success) return null
    const dto = result.data as SavedFilterDto
    const rule = dto.filters?.filter?.trim() || dto.filters?.s?.trim() || ''
    previews.push({
      filter,
      rule,
      result: convertSavedFilter(dto, randomUUID()),
      imported_before: state.imported.includes(filter.id),
    })
  }
  return previews
}

function importPreviews(previews: SavedFilterPreview[]): SavedFilterImportOutcome {
  const lists = previews.flatMap((preview) => (preview.result.list ? [preview.result.list] : []))
  if (lists.length === 0) return { count: 0, list_id: null }
  importCustomLists(lists as unknown as CustomListWire[], lists.map((list) => list.saved_filter_id))
  const outcome = { count: lists.length, list_id: lists[0].id }
  broadcast('saved-filters-imported', outcome)
  broadcast('saved-filters-changed', getSavedFilterState())
  return outcome
}

/** Imports the filters `ids` (read again from the server); null when a read failed. */
export async function importSavedFilters(ids: number[]): Promise<SavedFilterImportOutcome | null> {
  const previews = await previewSavedFilters(ids)
  if (!previews) return null
  return importPreviews(previews)
}

/** Hides the offer for `ids` on this device until another filter appears. */
export function dismissSavedFilters(ids: number[]): SavedFilterState {
  const config = loadConfig()
  if (!config) return getSavedFilterState()
  const store = storeOf(config)
  store.dismissed = [...new Set([...(store.dismissed ?? []), ...ids])].sort((a, b) => a - b)
  saveConfig(config)
  const state = getSavedFilterState()
  broadcast('saved-filters-changed', state)
  return state
}

/** Closes the first-open notice of the imported list `listId` on this device. */
export function closeImportNotice(listId: string): SavedFilterState {
  const config = loadConfig()
  if (!config) return getSavedFilterState()
  const store = storeOf(config)
  if (!(store.notice_closed ?? []).includes(listId)) {
    store.notice_closed = [...(store.notice_closed ?? []), listId]
    saveConfig(config)
  }
  const state = getSavedFilterState()
  broadcast('saved-filters-changed', state)
  return state
}

let firstConnectRunning = false

/**
 * The step after a custom-list sync: drop duplicate imports, and on this device's first connect
 * import every readable filter not imported yet. Without a read of the carrier (a sync that did not
 * end idle) the import record is not known, so nothing is imported.
 */
async function afterCustomListSync(status: CustomListSyncStatus): Promise<void> {
  if (status.state !== 'idle') return
  dropDuplicateCustomListImports()
  const config = loadConfig()
  if (!config || config.standalone_mode || config.saved_filters?.first_connect_done || firstConnectRunning) return
  firstConnectRunning = true
  try {
    if (!(await readKnown())) return
    const imported = importedSavedFilterIds()
    const wanted = getSavedFilterState().known.filter((filter) => !imported.includes(filter.id)).map((filter) => filter.id)
    if (wanted.length > 0) {
      const previews = await previewSavedFilters(wanted)
      if (!previews) return
      importPreviews(previews)
    }
    const latest = loadConfig()
    if (!latest) return
    storeOf(latest).first_connect_done = true
    saveConfig(latest)
  } finally {
    firstConnectRunning = false
  }
}

let started = false

/**
 * Hooks the import into the custom-list sync; called once at app start, before the first sync.
 * Kept out of the module's load so that the IPC tests, which mock the custom-list service, can
 * load this file.
 */
export function startSavedFilterImport(): void {
  if (started) return
  started = true
  setAfterCustomListSync(afterCustomListSync)
  // The data belongs to the account: a sign-in by someone else clears it with the other account keys.
  onAccountDataCleared(() => broadcast('saved-filters-changed', getSavedFilterState()))
}
