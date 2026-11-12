import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { createTask, updateTask } from './api-client'
import { loadProArchiveParts, loadProLedgerCarriers, rememberCreatedTask } from './carrier-service'
import { loadConfig, type AppConfig } from './config'
import { invalidateProjectCounts } from './project-counts-service'
import { createSyncedDocumentService, type SyncedDocumentCodec, type SyncedDocumentStatus } from './synced-document-service'
import {
  PRO_LEDGER_TITLE,
  encodeProArchiveEnvelope,
  encodeProLedgerEnvelope,
  hasProLedgerMarker,
  parseProArchiveEnvelope,
  parseProLedgerEnvelope,
  proArchiveTitle,
} from './pro-ledger-protocol'
import { canonicalJson, hiddenTaskForcedFields } from '../shared/hidden-tasks'
import { toLocalDate } from '../shared/due-dates'
import {
  LEDGER_COLLECTIONS,
  LEDGER_WARN_BYTES,
  addToArchivePart,
  archivePlan,
  emptyArchivePart,
  emptyLedger,
  hasLedgerContent,
  ledgerJsonBytes,
  mergeLedger,
  normalizeLedger,
  pruneLedger,
  remapLedgerTaskId,
  sameLedger,
  setEstimate,
  setLedgerRecord,
  setLedgerSettings,
  tombstoneMoved,
  type ArchiveRecords,
  type LedgerCollection,
  type ProArchivePart,
  type ProLedger,
} from '../shared/pro/ledger'
import { isProEnabled } from '../shared/pro/settings'
import type { ProLedgerOperation, ProLedgerSnapshot } from '../shared/pro/ledger-ipc'

/**
 * The Pro ledger (docs/cross-app-semantics-v1.md section 21.7): one hidden carrier per account
 * (`vicu-pro:v1`, created in the Inbox only when it holds something) on the generic synced-document
 * loop, plus the archive parts per quarter, written when records have been closed for 180 days and
 * read on demand. The local copy is `pro_ledger_sync` in config.json; the windows read it through
 * IPC (`pro-ledger:get`, `pro-ledger:mutate`) and get `pro-ledger-changed`.
 *
 * Nothing here runs while Pro is off on this device (O1: a device with Pro off sends what it sent
 * before Pro), except that the local copy stays as it is (O2).
 */

type LedgerState = NonNullable<AppConfig['pro_ledger_sync']>

export const PRO_LEDGER_CHANGED_CHANNEL = 'pro-ledger-changed'
export const PRO_LEDGER_STATUS_CHANNEL = 'pro-ledger-sync-status'

export type { ProLedgerOperation, ProLedgerSnapshot }

function ensureState(config: AppConfig): LedgerState {
  const current = config.pro_ledger_sync
  if (current) {
    try {
      current.document = normalizeLedger(current.document)
      if (!current.device_id) current.device_id = randomUUID()
      return current
    } catch {
      // A damaged local copy starts over empty: the carrier still holds what was synced.
    }
  }
  config.pro_ledger_sync = { device_id: current?.device_id || randomUUID(), document: emptyLedger(), dirty: false }
  return config.pro_ledger_sync
}

function sendToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch { /* window may close between enumeration and send */ }
  }
}

function snapshotOf(config: AppConfig): ProLedgerSnapshot {
  const state = ensureState(config)
  return { ledger: state.document, deviceId: state.device_id, nearlyFull: ledgerJsonBytes(state.document) > LEDGER_WARN_BYTES }
}

let lastBroadcast: string | null = null

function broadcast(config: AppConfig): void {
  const snapshot = snapshotOf(config)
  const json = canonicalJson(snapshot)
  if (json === lastBroadcast) return
  lastBroadcast = json
  sendToWindows(PRO_LEDGER_CHANGED_CHANNEL, snapshot)
}

const codec: SyncedDocumentCodec<ProLedger> = {
  isCarrier: (description) => hasProLedgerMarker(description),
  parse(description) {
    const parsed = parseProLedgerEnvelope(description)
    if (parsed.document) return { document: parsed.document }
    return { futureVersion: parsed.futureVersion, error: parsed.error }
  },
  encode: encodeProLedgerEnvelope,
  normalize: (document) => normalizeLedger(document),
  empty: () => emptyLedger(),
  merge: mergeLedger,
  prune: pruneLedger,
  same: sameLedger,
  worthCreating: (document) => hasLedgerContent(document),
}

const service = createSyncedDocumentService<ProLedger>({
  logTag: '[ProLedger]',
  title: PRO_LEDGER_TITLE,
  statusChannel: PRO_LEDGER_STATUS_CHANNEL,
  stateKey: 'pro_ledger_sync',
  messages: {
    connect: 'Connect to Vikunja to sync Pro',
    accountChanged: 'Account changed during the Pro sync',
    retrying: 'Pro data changed during sync; retrying',
    malformed: 'A malformed Pro ledger was ignored; valid data was preserved',
    updateRequired: 'Update Vicu to sync Pro',
    verifyFailed: 'Cannot verify the Pro ledger',
    chooseInbox: 'Choose an Inbox project before syncing Pro',
    failed: 'Pro sync failed',
  },
  codec,
  ensureState,
  changed: broadcast,
  beforeChange: (config) => {
    if (lastBroadcast === null && config) lastBroadcast = canonicalJson(snapshotOf(config))
  },
  loadCarriers: () => loadProLedgerCarriers(),
  afterSync: (config) => {
    // Archiving runs after a good sync, in the background; its tombstones are a change of their own.
    void archiveClosedRecords(config)
    return false
  },
})

function proOn(): boolean {
  return isProEnabled(loadConfig())
}

/** Syncs the ledger, only while Pro is on. */
export function syncProLedger(): Promise<SyncedDocumentStatus> {
  if (!proOn()) return Promise.resolve(service.status())
  return service.sync()
}

export function getProLedgerStatus(): SyncedDocumentStatus {
  return service.status()
}

export function hasUnsyncedProLedgerChanges(): boolean {
  return proOn() && service.hasUnsyncedChanges()
}

export function discardUnsyncedProLedgerChanges(): boolean {
  return service.discardUnsynced()
}

export function getProLedger(): ProLedgerSnapshot {
  const config = loadConfig()
  if (!config) return { ledger: emptyLedger(), deviceId: '', nearlyFull: false }
  return snapshotOf(config)
}

function isOperation(value: unknown): value is ProLedgerOperation {
  if (!value || typeof value !== 'object') return false
  const op = value as Record<string, unknown>
  switch (op.op) {
    case 'set':
      return (LEDGER_COLLECTIONS as readonly unknown[]).includes(op.collection) && typeof op.id === 'string' && op.id !== '' && op.id.length <= 64
    case 'settings':
      return !!op.value && typeof op.value === 'object' && !Array.isArray(op.value)
    case 'estimate':
      return typeof op.taskId === 'number' && Number.isInteger(op.taskId) && (op.minutes === null || (typeof op.minutes === 'number' && op.minutes >= 0 && op.minutes <= 1440))
    case 'remap':
      return typeof op.from === 'number' && typeof op.to === 'number' && Number.isInteger(op.from) && Number.isInteger(op.to)
    default:
      return false
  }
}

function apply(document: ProLedger, operations: readonly ProLedgerOperation[], deviceId: string, now: number): ProLedger {
  let next = document
  for (const operation of operations) {
    switch (operation.op) {
      case 'set':
        next = setLedgerRecord(next, operation.collection, operation.id, (operation.value ?? null) as never, deviceId, now)
        break
      case 'settings':
        next = setLedgerSettings(next, operation.value, deviceId, now)
        break
      case 'estimate':
        next = setEstimate(next, operation.taskId, operation.minutes, now)
        break
      case 'remap':
        next = remapLedgerTaskId(next, operation.from, operation.to)
        break
    }
  }
  return next
}

/**
 * Changes made in a window: applied to the current local copy in one change, saved as unsynced and
 * synced (while Pro is on). Every operation is checked first; none is applied when one is not valid.
 */
export function mutateProLedger(operations: unknown): ProLedgerSnapshot {
  if (!Array.isArray(operations) || !operations.every(isOperation)) throw new Error('Invalid Pro ledger change')
  if (operations.length === 0) return getProLedger()
  const config = service.mutate((document, deviceId) => apply(document, operations, deviceId, Date.now()))
  return snapshotOf(config)
}

/**
 * The offline queue made a task created offline real: its temporary id becomes the server id in the
 * ledger too (section 21.7). Called by the replay; does nothing when the ledger never named it.
 */
export function remapProLedgerTask(from: number, to: number): void {
  const config = loadConfig()
  if (!config?.pro_ledger_sync) return
  const document = config.pro_ledger_sync.document
  if (sameLedger(remapLedgerTaskId(document, from, to), document)) return
  service.mutate((current, deviceId) => {
    const now = Date.now()
    let next = remapLedgerTaskId(current, from, to)
    // The record under its new id is a change of its own, and the temporary id gets a tombstone, so
    // a copy synced before the replay cannot bring the old key back.
    const promise = next.promises[String(to)]
    if (promise && promise.value) next = setLedgerRecord(next, 'promises', String(to), promise.value, deviceId, now)
    if (String(from) in current.promises) next = setLedgerRecord(next, 'promises', String(from), null, deviceId, now)
    return next
  })
}

// --- Archive parts (section 21.7) ----------------------------------------------------------------

let archiving = false

/** Moves records closed more than 180 days ago to the archive part of their quarter. */
async function archiveClosedRecords(config: AppConfig): Promise<void> {
  if (archiving || !isProEnabled(config)) return
  const state = config.pro_ledger_sync
  if (!state) return
  const plan = archivePlan(state.document, toLocalDate(new Date()))
  if (plan.moved.length === 0) return
  archiving = true
  try {
    const found = await loadProArchiveParts()
    if (!found.success) return
    const existing = new Map<string, { id: number; part: ProArchivePart }>()
    for (const task of found.data) {
      const parsed = parseProArchiveEnvelope(task.description)
      if (parsed.document && !existing.has(parsed.document.quarter)) existing.set(parsed.document.quarter, { id: task.id, part: parsed.document })
    }
    const inbox = loadConfig()?.inbox_project_id ?? 0
    for (const [quarter, records] of Object.entries(plan.parts)) {
      const current = existing.get(quarter)
      const part = addToArchivePart(current?.part ?? emptyArchivePart(quarter), records)
      const fields = { title: proArchiveTitle(quarter), description: encodeProArchiveEnvelope(part), ...hiddenTaskForcedFields() }
      if (current) {
        const written = await updateTask(current.id, fields)
        if (!written.success) return
      } else {
        if (!inbox) return
        const created = await createTask(inbox, fields)
        if (!created.success) return
        if (rememberCreatedTask(created.data)) invalidateProjectCounts()
      }
    }
    service.mutate((document, deviceId) => tombstoneMoved(document, plan.moved, deviceId, Date.now()))
  } catch (error) {
    console.warn('[ProLedger] Archiving failed:', error instanceof Error ? error.message : error)
  } finally {
    archiving = false
  }
}

/** Every archive part's records, merged (the quarterly summary). Read only. */
export async function readProArchive(): Promise<ArchiveRecords> {
  if (!proOn()) return {}
  const found = await loadProArchiveParts()
  if (!found.success) throw new Error(found.error)
  let merged: ProArchivePart = emptyArchivePart('all')
  for (const task of found.data) {
    const parsed = parseProArchiveEnvelope(task.description)
    if (parsed.document) merged = addToArchivePart(merged, parsed.document)
  }
  const { version: _version, quarter: _quarter, ...records } = merged
  return records as ArchiveRecords
}

/** For tests. */
export function resetProLedgerForTests(): void {
  lastBroadcast = null
  archiving = false
}
