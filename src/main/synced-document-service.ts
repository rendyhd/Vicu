import { sendToAllWindows } from '@host/windows'
import { t } from '../shared/i18n'
import { createTask, deleteTask, fetchTaskById, updateTask } from './api-client'
import type { ApiResult } from './api-result'
import { OWNER_UNKNOWN_ERROR, forgetDeletedTask, rememberCreatedTask } from './carrier-service'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { ensureKnownUserId } from './known-user'
import { invalidateProjectCounts } from './project-counts-service'
import { hiddenTaskForcedFields, isOwnTask } from '../shared/hidden-tasks'
import type { CustomListSyncStatus } from '../shared/config-types'

/**
 * One synced document kept in a hidden carrier task (docs/cross-app-semantics-v1.md sections 10
 * and 11): the custom lists (`vicu-custom-lists:v1`) and the synced preferences (`vicu-prefs:v1`).
 *
 * The device keeps the whole document locally in config.json with an unsynced flag, so a change
 * works offline. A sync reads every carrier of the signed-in user, merges them into the local copy,
 * drops old tombstones, writes the result to the carrier with the lowest id when it differs (or
 * creates one in the Inbox when there is something to keep), reads it back, and finally deletes
 * the other carriers that hold nothing the kept one lacks. A carrier of a newer version makes the
 * kind read only ("update required"); a malformed one is ignored and reported. Android runs the
 * same loop (`SyncedDocumentSync`).
 */

/** The status shapes the windows already know from custom lists. */
export type SyncedDocumentStatus = CustomListSyncStatus

/** What config.json keeps per document (`custom_lists_sync`, `synced_prefs_sync`). */
export interface SyncedDocumentState<Doc> {
  device_id: string
  document: Doc
  dirty: boolean
  carrier_task_id?: number
  last_synced_at?: string
  /**
   * What the carrier held after the last successful sync, so a discard of unsynced changes can go
   * back to it at once, offline too. Missing before the first sync with this version, and when the
   * user has no carrier.
   */
  synced_document?: Doc
}

export interface ParsedDocumentCarrier<Doc> {
  /** The readable document. */
  document?: Doc
  /** Set when a newer version wrote it: never written or deleted. */
  futureVersion?: number
  error?: string
}

/** The document rules of one kind. */
export interface SyncedDocumentCodec<Doc> {
  /** True when the description holds this kind's marker, readable or not. */
  isCarrier(description: string | undefined): boolean
  parse(description: string | undefined): ParsedDocumentCarrier<Doc>
  /** The description a carrier is written with (the marker only). */
  encode(document: Doc): string
  normalize(document: Doc): Doc
  /** The document of a device that holds nothing (what a discard starts from without a server copy). */
  empty(deviceId: string): Doc
  /** `merge(local, server)`. */
  merge(local: Doc, server: Doc): Doc
  /** The document without tombstones older than 90 days before `now`. */
  prune(document: Doc, now: number): Doc
  same(left: Doc, right: Doc): boolean
  /** Whether a carrier is created for this document when the user has none yet. */
  worthCreating(document: Doc, dirty: boolean): boolean
}

export interface SyncedDocumentMessages {
  /** Pending: no server configured. */
  connect: string
  accountChanged: string
  retrying: string
  malformed: string
  updateRequired: string
  verifyFailed: string
  chooseInbox: string
  failed: string
}

interface CarrierTask {
  id: number
  title?: string
  description?: string
  done?: boolean
  created_by?: { id?: unknown } | null
}

export interface SyncedDocumentOptions<Doc> {
  /** For log lines: `[CustomLists]`. */
  logTag: string
  /** The carrier's title, written again on every write. */
  title: string
  /** The IPC channel the windows get the status on. */
  statusChannel: string
  /** Where config.json keeps the local state. */
  stateKey: keyof AppConfig
  messages: SyncedDocumentMessages
  codec: SyncedDocumentCodec<Doc>
  /** The local state in `config` (made, or rebuilt when damaged, as needed; not saved). */
  ensureState(config: AppConfig): SyncedDocumentState<Doc>
  /** After the local document changed in `config`: derived fields (the custom lists themselves). Not saved here. */
  afterPersist?(config: AppConfig, state: SyncedDocumentState<Doc>): void
  /** After a saved change: tell the windows what changed (only when it did). */
  changed?(config: AppConfig): void
  /** Called once before a sync or change may alter what the windows show. */
  beforeChange?(config: AppConfig | null): void
  /** The user's carriers of this kind (`carrier-service.ts`). */
  loadCarriers(): Promise<ApiResult<CarrierTask[]>>
  /**
   * After a successful sync that read the carrier (the one-time move of synced preferences). It may
   * change and save the state; returning true asks for another sync once this one is over.
   */
  afterSync?(config: AppConfig, state: SyncedDocumentState<Doc>): boolean | void
  /** Defaults to `Date.now`; tests pass a clock. */
  now?: () => number
}

export interface SyncedDocumentService<Doc> {
  sync(): Promise<SyncedDocumentStatus>
  status(): SyncedDocumentStatus
  /**
   * A local change: `change` gets the current document and the device id and returns the new one.
   * It is saved, marked unsynced and a sync is started. Returns the saved config, or null.
   */
  mutate(change: (document: Doc, deviceId: string) => Doc): AppConfig
  /** Saves `document` as the local copy (the `dirty` flag given). */
  persist(config: AppConfig, document: Doc, dirty: boolean): void
  /** True when the local copy holds changes the server has not got (never in standalone mode or without a server). */
  hasUnsyncedChanges(): boolean
  /**
   * Drops the local changes that never reached the server: the local copy goes back to what the
   * carrier held after the last successful sync (empty when that is not known), is no longer
   * unsynced, and is read again from the carriers. Returns false when there was nothing to drop.
   */
  discardUnsynced(): boolean
}

/** The user id is not known yet: no carrier is discovered, nothing is written, the sync waits. */
class OwnerUnknownError extends Error {}
const OWNER_WAIT_MESSAGE = 'Waiting to confirm the signed-in account'

function looksOffline(message: string): boolean {
  return /offline|network|connect|timed?\s*out|ENOTFOUND|ECONN|ERR_/i.test(message)
}

function sendToWindows(send: (win: { webContents: { send(channel: string, ...args: unknown[]): void } }) => void): void {
  // One stand-in window whose send reaches every window (see @host/windows).
  send({ webContents: { send: sendToAllWindows } })
}

const sameServer = (config: AppConfig | null, url: string): boolean =>
  !!config && config.vikunja_url.replace(/\/+$/, '') === url

export function createSyncedDocumentService<Doc>(options: SyncedDocumentOptions<Doc>): SyncedDocumentService<Doc> {
  const { codec, messages } = options
  const now = options.now ?? (() => Date.now())
  let syncStatus: SyncedDocumentStatus = { state: 'idle' }
  let inFlightSync: Promise<SyncedDocumentStatus> | null = null
  let resyncRequested = false

  /** Unsynced local changes, as stored (no state is made up for a config that has none yet). */
  const isDirty = (config: AppConfig): boolean => (config[options.stateKey] as { dirty?: boolean } | undefined)?.dirty === true

  function setStatus(status: SyncedDocumentStatus): SyncedDocumentStatus {
    syncStatus = status
    sendToWindows((win) => win.webContents.send(options.statusChannel, syncStatus))
    return status
  }

  function persist(config: AppConfig, document: Doc, dirty: boolean): void {
    const state = options.ensureState(config)
    state.document = codec.normalize(document)
    state.dirty = dirty
    options.afterPersist?.(config, state)
    saveConfig(config)
  }

  async function fetchCarriers(): Promise<{ valid: Array<{ task: CarrierTask; document: Doc }>; malformed: number; futureVersion?: number }> {
    // Only the signed-in user's carriers, remembered ones by id and new ones by a marker search
    // (carrier-discovery.ts), done or reopened.
    const result = await options.loadCarriers()
    if (!result.success) {
      if (result.error === OWNER_UNKNOWN_ERROR) throw new OwnerUnknownError(result.error)
      throw new Error(result.error)
    }
    const valid: Array<{ task: CarrierTask; document: Doc }> = []
    let malformed = 0
    let futureVersion: number | undefined
    for (const task of result.data) {
      // By the marker only, never the title (cross-app semantics 10.1).
      if (!codec.isCarrier(task.description)) continue
      const parsed = codec.parse(task.description)
      if (parsed.document) valid.push({ task, document: parsed.document })
      else if (parsed.futureVersion) futureVersion = Math.max(futureVersion ?? 0, parsed.futureVersion)
      else malformed += 1
    }
    return { valid, malformed, futureVersion }
  }

  async function writeCarrier(taskId: number, document: Doc): Promise<void> {
    // Done, undated, not repeating and without reminders again, so an edit made in the web UI is
    // undone (cross-app semantics 10.2).
    const result = await updateTask(taskId, { title: options.title, description: codec.encode(document), ...hiddenTaskForcedFields() })
    if (!result.success) throw new Error(result.error)
  }

  /**
   * Creates the carrier already completed, in one request. Only a server that ignored `done` on
   * create (it would leave an open, visible carrier) gets a second one to finish it.
   */
  async function createCarrier(projectId: number, document: Doc): Promise<{ id: number; description?: string }> {
    const created = await createTask(projectId, { title: options.title, description: codec.encode(document), ...hiddenTaskForcedFields() })
    if (!created.success) throw new Error(created.error)
    const task = created.data as CarrierTask
    if (rememberCreatedTask(task)) invalidateProjectCounts()
    if (task.done !== true) {
      await writeCarrier(task.id, document)
      return { id: task.id }
    }
    // The create response is the stored task: it is the read-back, no extra request needed.
    return { id: task.id, description: task.description }
  }

  /**
   * Deletes the user's carriers that were created next to the one this app keeps (two devices that
   * first synced at the same time each made one). `kept` is what the kept carrier holds after a
   * successful write and read-back. An extra is read again right before it goes and is only deleted
   * when `prune(merge(kept, extra))` equals `kept` (section 10.5), so something another device just
   * wrote there is merged first, on the next sync. A carrier that cannot be read, of a newer
   * version, or of another user is never touched.
   */
  async function removeDuplicateCarriers(extras: Array<{ task: CarrierTask }>, kept: Doc): Promise<void> {
    const me = await ensureKnownUserId()
    for (const extra of extras) {
      try {
        const fresh = await fetchTaskById(extra.task.id)
        if (!fresh.success) {
          if (fresh.statusCode === 404) forgetDeletedTask(extra.task.id)
          continue
        }
        const task = fresh.data as CarrierTask
        if (!isOwnTask(task, me)) continue
        const parsed = codec.parse(task.description)
        if (!parsed.document) continue
        if (!codec.same(codec.prune(codec.merge(kept, parsed.document), now()), kept)) continue
        const removed = await deleteTask(extra.task.id)
        if (removed.success) forgetDeletedTask(extra.task.id)
        else console.warn(`${options.logTag} Could not delete the duplicate carrier ${extra.task.id}: ${removed.error}`)
      } catch (error) {
        console.warn(`${options.logTag} Could not clean up the duplicate carrier ${extra.task.id}:`, error instanceof Error ? error.message : error)
      }
    }
  }

  async function runSync(): Promise<SyncedDocumentStatus> {
    let config = loadConfig()
    options.beforeChange?.(config)
    if (!config) return setStatus({ state: 'error', message: t('system.sync.configNotLoaded') })
    if (config.standalone_mode) return setStatus({ state: 'local_only' })
    if (!config.vikunja_url) return setStatus({ state: 'pending', message: messages.connect })
    const syncUrl = config.vikunja_url.replace(/\/+$/, '')
    setStatus({ state: 'syncing' })
    // Set once the carriers were merged into the local copy: from then on a failure leaves the copy
    // unsynced, since it may hold what the carrier lacks. A failure before it leaves the flag alone.
    let merging = false

    try {
      const carriers = await fetchCarriers()
      if (carriers.futureVersion) {
        return setStatus({ state: 'update_required', message: messages.updateRequired })
      }
      // A local edit may have landed while the network read was in flight. Rebase the
      // merge on the newest main-owned document so that edit cannot be overwritten.
      const refreshedConfig = loadConfig()
      if (!sameServer(refreshedConfig, syncUrl)) {
        return setStatus({ state: 'pending', message: messages.accountChanged })
      }
      config = refreshedConfig!
      const state = options.ensureState(config)
      const hadPendingLocalChanges = state.dirty

      let merged = codec.normalize(state.document)
      for (const carrier of carriers.valid) merged = codec.merge(merged, carrier.document)
      // Tombstones older than 90 days are dropped before writing and before comparing (section
      // 10.6), so the document stops growing. A carrier that still holds them counts as changed.
      merged = codec.prune(merged, now())
      merging = true
      persist(config, merged, hadPendingLocalChanges)
      options.changed?.(config)

      const canonical = carriers.valid.map((entry) => entry.task).sort((a, b) => a.id - b.id)[0]
      let carrierId = canonical?.id
      const canonicalDocument = carriers.valid.find((entry) => entry.task.id === canonical?.id)?.document
      const needsWrite = canonicalDocument
        ? !codec.same(canonicalDocument, merged)
        : codec.worthCreating(merged, hadPendingLocalChanges)

      // What the carrier holds right now. Without a write that is what was just read; after a write
      // it is read back, so a server that altered the description is noticed.
      let verifiedDocument: Doc | undefined = canonicalDocument
      if (needsWrite) {
        verifiedDocument = undefined
        if (carrierId) await writeCarrier(carrierId, merged)
        else {
          if (!config.inbox_project_id) throw new Error(messages.chooseInbox)
          const created = await createCarrier(config.inbox_project_id, merged)
          carrierId = created.id
          if (created.description !== undefined) verifiedDocument = codec.parse(created.description).document
        }
      }

      if (carrierId) {
        if (!verifiedDocument) {
          const verified = await fetchTaskById(carrierId)
          if (!verified.success) throw new Error(verified.error)
          const parsed = codec.parse((verified.data as CarrierTask).description)
          if (!parsed.document) throw new Error(parsed.error || messages.verifyFailed)
          verifiedDocument = parsed.document
        }
        const latest = loadConfig() ?? config
        if (!sameServer(latest, syncUrl)) {
          return setStatus({ state: 'pending', message: messages.accountChanged })
        }
        // Include edits made while the write/verification request was in flight. If the
        // carrier does not contain them yet, keep the merged local document dirty. Compared
        // after pruning, like every merge result.
        const latestLocalDocument = options.ensureState(latest).document
        const converged = codec.prune(codec.merge(codec.merge(merged, verifiedDocument), latestLocalDocument), now())
        if (!codec.same(converged, verifiedDocument)) {
          persist(latest, converged, true)
          options.changed?.(latest)
          return setStatus({ state: 'pending', message: messages.retrying })
        }
        merged = converged
        config = latest
      }

      const lastSyncedAt = new Date().toISOString()
      const latest = loadConfig() ?? config
      const latestState = options.ensureState(latest)
      latestState.document = codec.normalize(merged)
      latestState.carrier_task_id = carrierId
      latestState.dirty = false
      latestState.last_synced_at = lastSyncedAt
      // The carrier holds exactly `merged` now (read back above), or the user has none.
      if (carrierId) latestState.synced_document = codec.normalize(merged)
      else delete latestState.synced_document
      options.afterPersist?.(latest, latestState)
      saveConfig(latest)
      options.changed?.(latest)
      if (options.afterSync?.(latest, latestState)) resyncRequested = true
      // The oldest carrier now holds everything: the other carriers are only clutter in the user's
      // Vikunja, so remove them. Never part of the sync result; a failure is retried next time.
      if (carrierId) {
        await removeDuplicateCarriers(carriers.valid.filter((entry) => entry.task.id !== carrierId), merged)
      }
      if (carriers.malformed > 0) {
        return setStatus({ state: 'error', message: messages.malformed })
      }
      return setStatus({ state: 'idle', last_synced_at: lastSyncedAt })
    } catch (error) {
      if (error instanceof OwnerUnknownError) {
        return setStatus({ state: 'pending', message: OWNER_WAIT_MESSAGE })
      }
      const message = error instanceof Error ? error.message : messages.failed
      const latest = loadConfig()
      if (latest && merging) {
        const latestState = options.ensureState(latest)
        latestState.dirty = true
        saveConfig(latest)
      }
      return setStatus(looksOffline(message) ? { state: 'offline', message } : { state: 'error', message })
    }
  }

  function sync(): Promise<SyncedDocumentStatus> {
    if (inFlightSync) return inFlightSync
    inFlightSync = runSync().finally(() => {
      inFlightSync = null
      if (resyncRequested) {
        resyncRequested = false
        setTimeout(() => { void sync() }, 0)
        return
      }
      const config = loadConfig()
      // Retried at once only when the document changed during the sync; a sync that waits for the
      // user id runs again with the next trigger (the lookup asks the server at most once a minute).
      if (syncStatus.state === 'pending' && syncStatus.message !== OWNER_WAIT_MESSAGE && config?.vikunja_url && isDirty(config)) {
        setTimeout(() => { void sync() }, 250)
      }
    })
    return inFlightSync
  }

  function status(): SyncedDocumentStatus {
    const config = loadConfig()
    if (config?.standalone_mode) return { state: 'local_only' }
    if (config && isDirty(config) && syncStatus.state === 'idle') return { state: 'pending' }
    return syncStatus
  }

  function mutate(change: (document: Doc, deviceId: string) => Doc): AppConfig {
    const config = loadConfig()
    if (!config) throw new Error('Configuration not loaded')
    options.beforeChange?.(config)
    const state = options.ensureState(config)
    persist(config, change(codec.normalize(state.document), state.device_id), true)
    setStatus(config.standalone_mode ? { state: 'local_only' } : { state: 'pending' })
    options.changed?.(config)
    if (!config.standalone_mode) void sync()
    return config
  }

  /** Only a copy that can reach a server has changes to discard; standalone lists are local by design. */
  function hasUnsyncedChanges(): boolean {
    const config = loadConfig()
    return !!config && !config.standalone_mode && !!config.vikunja_url && isDirty(config)
  }

  /** The last synced server copy, when it is still readable (round-tripped through the carrier format). */
  function syncedCopy(state: SyncedDocumentState<Doc>): Doc | undefined {
    if (state.synced_document === undefined) return undefined
    try {
      return codec.parse(codec.encode(state.synced_document)).document
    } catch {
      return undefined
    }
  }

  function discardUnsynced(): boolean {
    if (!hasUnsyncedChanges()) return false
    const config = loadConfig()!
    options.beforeChange?.(config)
    const state = options.ensureState(config)
    // Android clears its copy and reads it back (LocalDataWiper). Going back to the last server
    // copy first gives the same result once the carrier is read, and keeps the lists and settings
    // the server had while it cannot be reached.
    persist(config, syncedCopy(state) ?? codec.empty(state.device_id), false)
    options.changed?.(config)
    setStatus({ state: 'pending' })
    // A sync that is running may have read the old copy: read the carriers again after it.
    if (inFlightSync) resyncRequested = true
    else void sync()
    return true
  }

  return { sync, status, mutate, persist, hasUnsyncedChanges, discardUnsynced }
}
