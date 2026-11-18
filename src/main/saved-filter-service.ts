/**
 * Vikunja saved filters and project views as custom lists (docs/cross-app-semantics-v1.md,
 * sections 3.7 and 3.9). Android has the same in `SavedFilterImporter.kt`.
 *
 * - The project read records the saved filters it finds, with their `updated`
 *   (`recordKnownSavedFilters`).
 * - After the first custom-list sync that read the carrier on this version, every readable filter
 *   not imported yet is imported, once per device (`first_connect_done`).
 * - After that, Settings offers the filters that are new, and the imported filters a read after a
 *   sync found changed in Vikunja; the review sheet (filters and project views) is always there.
 * - Importing a source that already has a list never adds a second one: the person answers
 *   Overwrite or Skip, and the answers are written as one change with one Undo.
 * - The carrier's `imported_saved_filters` (a union) keeps two devices from importing one filter
 *   twice; a duplicate that slipped through is turned into a tombstone after each sync.
 *
 * An import is a copy: the saved filter or view on the server is never changed or deleted.
 */
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { fetchProjectViews, fetchProjectsAndSavedFilters, fetchSavedFilter } from './api-client'
import { loadConfig, saveConfig, type AppConfig } from './config'
import {
  dropDuplicateCustomListImports,
  getCustomListWires,
  importCustomLists,
  importedSavedFilterIds,
  restoreCustomLists,
  setAfterCustomListSync,
} from './custom-list-service'
import { importSourceKey, type CustomListWire } from './custom-list-protocol'
import { onAccountDataCleared } from './known-user'
import {
  compareImport,
  convertProjectView,
  convertSavedFilter,
  importBaseOf,
  isViewOffered,
  overwriteImport,
  savedFilterIdOf,
  skipImport,
  viewListName,
  type ComparableList,
  type ImportAnswer,
  type ImportResult,
  type ProjectViewDto,
  type SavedFilterDto,
  type SavedFilterImportOutcome,
  type SavedFilterPreview,
  type SavedFilterRef,
  type SavedFilterState,
  type ViewProject,
} from '../shared/saved-filter-import'
import type { CustomList, CustomListSyncStatus } from '../shared/config-types'

type Store = NonNullable<AppConfig['saved_filters']>

/** How many project views are read at once for the review sheet. */
const VIEW_READS = 6

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

/** The list that holds the saved filter `filterId`, if any. */
function listOfFilter<T extends { saved_filter_id?: unknown }>(lists: T[], filterId: number): T | undefined {
  return lists.find((list) => list.saved_filter_id === filterId)
}

/**
 * Imported filters whose pseudo-project moved past their list's base and that a read found
 * changed in Vikunja, not answered and not put off since ("Changed in Vikunja", section 3.7).
 */
function changedOffer(store: Store, lists: CustomList[]): SavedFilterRef[] {
  return store.known.filter((ref) => {
    const list = listOfFilter(lists, ref.id)
    const base = list ? importBaseOf(list) : null
    const updated = ref.updated ?? ''
    if (!base || updated === '') return false
    return store.changed?.[ref.id] === updated && store.changed_dismissed?.[ref.id] !== updated && base.updated !== updated
  })
}

export function getSavedFilterState(): SavedFilterState {
  const config = loadConfig()
  const store = config?.saved_filters ?? { known: [] }
  const imported = importedSavedFilterIds()
  const dismissed = new Set(store.dismissed ?? [])
  return {
    known: store.known,
    offer: store.known.filter((filter) => !imported.includes(filter.id) && !dismissed.has(filter.id)),
    changed_offer: changedOffer(store, config?.custom_lists ?? []),
    imported,
    notice_closed: store.notice_closed ?? [],
  }
}

/** Records the saved filters among the pseudo-projects a project read returned. */
export function recordKnownSavedFilters(pseudo: Array<{ id: number; title?: string; updated?: string }>): void {
  const config = loadConfig()
  if (!config) return
  const known: SavedFilterRef[] = pseudo
    .map((project) => ({
      id: savedFilterIdOf(project.id),
      title: project.title ?? '',
      updated: typeof project.updated === 'string' ? project.updated : '',
    }))
    .filter((ref): ref is SavedFilterRef & { updated: string } => ref.id !== null)
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

/**
 * The previews the review sheet showed last, by key, so that Import and the answers write what the
 * person saw. Read again when one is missing (a saved filter only).
 */
const lastPreviews = new Map<string, SavedFilterPreview>()

function preview(
  key: string,
  title: string,
  rule: string,
  result: ImportResult,
  importedBefore: boolean,
  existing: CustomListWire | undefined,
): SavedFilterPreview {
  const comparison = result.list && existing ? compareImport(existing, result.list) : undefined
  const made: SavedFilterPreview = {
    key,
    title,
    rule,
    result,
    imported_before: importedBefore,
    ...(existing ? { existing } : {}),
    ...(comparison ? { comparison } : {}),
  }
  lastPreviews.set(key, made)
  return made
}

/** The review sheet's rows for `ids` (every known filter when absent); null when a read failed. */
export async function previewSavedFilters(ids?: number[]): Promise<SavedFilterPreview[] | null> {
  const state = getSavedFilterState()
  const wanted = ids ? state.known.filter((filter) => ids.includes(filter.id)) : state.known
  const lists = getCustomListWires()
  const previews: SavedFilterPreview[] = []
  for (const filter of wanted) {
    const result = await fetchSavedFilter(filter.id)
    if (!result.success) return null
    const dto = result.data as SavedFilterDto
    const rule = dto.filters?.filter?.trim() || dto.filters?.s?.trim() || ''
    const existing = listOfFilter(lists, filter.id)
    previews.push({
      ...preview(
        `filter:${filter.id}`,
        filter.title,
        rule,
        convertSavedFilter(dto, existing?.id ?? randomUUID()),
        state.imported.includes(filter.id) || existing !== undefined,
        existing,
      ),
      filter_id: filter.id,
    })
    lastPreviews.set(`filter:${filter.id}`, previews[previews.length - 1])
  }
  return previews
}

/** Runs `work` over `items` with at most `limit` at a time, keeping their order. */
async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * The review sheet's rows for the account's project views (section 3.9): every view that is
 * offered, and every view a list holds. Null when the server could not be read.
 */
export async function previewProjectViews(): Promise<SavedFilterPreview[] | null> {
  const projectsRead = await fetchProjectsAndSavedFilters(false)
  if (!projectsRead.success) return null
  type ProjectDto = { id: number; title?: string; is_archived?: boolean; position?: number }
  const projects = (projectsRead.data.projects as ProjectDto[])
    .filter((project) => typeof project?.id === 'number' && project.id >= 1)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const reads = await mapLimited(projects, VIEW_READS, async (project) => ({ project, result: await fetchProjectViews(project.id) }))
  if (reads.some((read) => !read.result.success)) return null
  const lists = getCustomListWires()
  const previews: SavedFilterPreview[] = []
  for (const { project: dto, result } of reads) {
    if (!result.success) continue
    const project: ViewProject = { id: dto.id, title: dto.title ?? '', archived: dto.is_archived === true }
    const views = (result.data as ProjectViewDto[])
      .filter((view) => typeof view?.id === 'number')
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    for (const view of views) {
      const existing = lists.find((list) => importSourceKey(list) === `view:${view.id}`)
      if (!existing && !isViewOffered(project, view)) continue
      const query = view.filter ?? {}
      previews.push({
        ...preview(
          `view:${view.id}`,
          viewListName(project, view),
          query.filter?.trim() || query.s?.trim() || '',
          convertProjectView(project, view, existing?.id ?? randomUUID()),
          existing !== undefined,
          existing,
        ),
        view: project,
      })
      lastPreviews.set(`view:${view.id}`, previews[previews.length - 1])
    }
  }
  return previews
}

function announce(outcome: SavedFilterImportOutcome): SavedFilterImportOutcome {
  if (outcome.count > 0 || (outcome.updated ?? 0) > 0 || (outcome.skipped ?? 0) > 0) {
    broadcast('saved-filters-imported', outcome)
  }
  broadcast('saved-filters-changed', getSavedFilterState())
  return outcome
}

/** Imports the previews' sources that have no list yet as new lists. */
function importPreviews(previews: SavedFilterPreview[]): SavedFilterImportOutcome {
  const lists = previews.flatMap((item) => (item.result.list && !item.existing ? [item.result.list] : []))
  if (lists.length === 0) return { count: 0, list_id: null }
  importCustomLists(lists as unknown as CustomListWire[], filterIdsOf(lists))
  return announce({ count: lists.length, list_id: lists[0].id })
}

function filterIdsOf(lists: Array<{ saved_filter_id?: unknown }>): number[] {
  return lists.flatMap((list) => (typeof list.saved_filter_id === 'number' ? [list.saved_filter_id] : []))
}

/** The preview the sheet showed for `key`, read again for a saved filter the cache lost. */
async function previewFor(key: string): Promise<SavedFilterPreview | null> {
  const cached = lastPreviews.get(key)
  if (cached) return cached
  const match = /^filter:(\d+)$/.exec(key)
  if (!match) return null
  const read = await previewSavedFilters([Number(match[1])])
  return read?.[0] ?? null
}

/** What one write of answers did, kept for its Undo. */
let lastUndo: { id: string; remove: string[]; restore: CustomListWire[] } | null = null

/**
 * The review sheet's Import (sections 3.7 and 3.9): the sources `add` (keys of the sheet's rows)
 * that have no list become new lists, and each source in `answers` that has one is overwritten or
 * skipped. One change, with one Undo when answers were given. Null when a source could not be read.
 */
export async function applySavedFilterImport(
  add: string[],
  answers: Array<{ key: string; answer: ImportAnswer }>,
): Promise<SavedFilterImportOutcome | null> {
  const lists = getCustomListWires()
  const added: CustomListWire[] = []
  for (const key of add) {
    const item = await previewFor(key)
    if (!item) return null
    // A source that got a list since the sheet was read is not imported a second time.
    if (!item.result.list || lists.some((list) => importSourceKey(list) === key)) continue
    added.push(item.result.list as unknown as CustomListWire)
  }
  const written: CustomListWire[] = []
  const before: CustomListWire[] = []
  let updated = 0
  for (const { key, answer } of answers) {
    const item = await previewFor(key)
    if (!item) return null
    const listId = item.existing?.id
    const current = lists.find((list) => list.id === listId)
    if (!current || !item.result.list) continue
    const fresh = { ...item.result.list, id: current.id } as unknown as ComparableList
    written.push(answer === 'overwrite' ? overwriteImport(current, fresh) : skipImport(current, fresh))
    before.push(current)
    if (answer === 'overwrite') updated++
  }
  if (added.length === 0 && written.length === 0) return { count: 0, list_id: null }
  importCustomLists([...added, ...written], filterIdsOf([...added, ...written]))
  const outcome: SavedFilterImportOutcome = { count: added.length, list_id: added[0]?.id ?? written[0]?.id ?? null }
  if (written.length > 0) {
    lastUndo = { id: randomUUID(), remove: added.map((list) => list.id), restore: before }
    outcome.updated = updated
    outcome.skipped = written.length - updated
    outcome.undo_id = lastUndo.id
  }
  return announce(outcome)
}

/** Undo of the last answers: removes the lists they added and puts every answered list back. */
export function undoSavedFilterImport(undoId: string): boolean {
  if (!lastUndo || lastUndo.id !== undoId) return false
  const { remove, restore } = lastUndo
  lastUndo = null
  restoreCustomLists(remove, restore)
  broadcast('saved-filters-changed', getSavedFilterState())
  return true
}

/**
 * Hides the offer for `ids` on this device until another filter appears, and the changes of
 * `changedIds` until those filters change again.
 */
export function dismissSavedFilters(ids: number[], changedIds: number[] = []): SavedFilterState {
  const config = loadConfig()
  if (!config) return getSavedFilterState()
  const store = storeOf(config)
  if (ids.length > 0) store.dismissed = [...new Set([...(store.dismissed ?? []), ...ids])].sort((a, b) => a - b)
  if (changedIds.length > 0) {
    const dismissedChanges = { ...(store.changed_dismissed ?? {}) }
    for (const ref of store.known) {
      if (changedIds.includes(ref.id) && ref.updated) dismissedChanges[ref.id] = ref.updated
    }
    store.changed_dismissed = dismissedChanges
  }
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

/** Notes, in the store of the config read now, that `filterId` was read (and found changed) at `updated`. */
function markChecked(filterId: number, updated: string, changed: boolean): void {
  const config = loadConfig()
  if (!config) return
  const store = storeOf(config)
  store.checked = { ...(store.checked ?? {}), [filterId]: updated }
  if (changed) store.changed = { ...(store.changed ?? {}), [filterId]: updated }
  saveConfig(config)
}

/**
 * Reads each imported filter whose `updated` moved past its list's base, once per new value, and
 * notes the ones changed in Vikunja for the offer ("Changed in Vikunja", section 3.7).
 */
async function checkChanged(): Promise<void> {
  const known = loadConfig()?.saved_filters?.known ?? []
  const lists = getCustomListWires()
  let found = false
  for (const ref of known) {
    const list = listOfFilter(lists, ref.id)
    const base = list ? importBaseOf(list) : null
    const updated = ref.updated ?? ''
    if (!list || !base || updated === '' || updated === base.updated) continue
    if (loadConfig()?.saved_filters?.checked?.[ref.id] === updated) continue
    const result = await fetchSavedFilter(ref.id)
    if (!result.success) {
      console.warn('[SavedFilters] Reading a changed saved filter failed:', result.error)
      return
    }
    const fresh = convertSavedFilter(result.data as SavedFilterDto, list.id).list
    const status = fresh ? compareImport(list, fresh as unknown as ComparableList).status : null
    const changed = status === 'vikunja' || status === 'both'
    markChecked(ref.id, updated, changed)
    if (changed) found = true
  }
  if (found) broadcast('saved-filters-changed', getSavedFilterState())
}

let afterSyncRunning = false

/**
 * The step after a custom-list sync: drop duplicate imports; on this device's first connect import
 * every readable filter not imported yet, and after that look for imported filters that changed in
 * Vikunja. Without a read of the carrier (a sync that did not end idle) the import record is not
 * known, so nothing is imported.
 */
async function afterCustomListSync(status: CustomListSyncStatus): Promise<void> {
  if (status.state !== 'idle') return
  dropDuplicateCustomListImports()
  const config = loadConfig()
  if (!config || config.standalone_mode || afterSyncRunning) return
  afterSyncRunning = true
  try {
    if (config.saved_filters?.first_connect_done) {
      await checkChanged()
      return
    }
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
    afterSyncRunning = false
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
  onAccountDataCleared(() => {
    lastPreviews.clear()
    lastUndo = null
    broadcast('saved-filters-changed', getSavedFilterState())
  })
}
