import { app } from 'electron'
import { join } from 'path'
import type { OfflineQueueChange } from '../../shared/offline-queue-types'
import { loadConfig } from '../config'
import { getMainWindow, getQuickEntryWindow, getQuickViewWindow } from '../quick-entry-state'
import { OFFLINE_ATTACHMENTS_DIRNAME } from './attachments'
import { QUEUE_FILENAME, ensureLegacyMigration } from './legacy-migration'
import { normalizeServerUrl, type OfflineOwner } from './owner'
import { OfflineQueue } from './queue'

/** IPC events the queue sends to the app windows (main window, Quick Entry, Quick View). */
export const OFFLINE_EVENTS = {
  /** `{ counts, replaying, authProblem }` after every change to the queue. */
  changed: 'offline-queue:changed',
  /** An `OfflineReplayEvent` when a replay finishes. */
  replayed: 'offline-queue:replayed',
  /** `{ error }` when the replay stopped on a session or token problem. */
  authProblem: 'offline-queue:auth-problem',
} as const

/** Send to the windows that run Vicu's own pages. Hidden windows still receive it. */
export function sendToAppWindows(channel: string, ...args: unknown[]): void {
  for (const get of [getMainWindow, getQuickEntryWindow, getQuickViewWindow]) {
    try {
      const win = get()
      if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
    } catch {
      // A window that is going away is not a reason to fail a queue operation.
    }
  }
}

let queue: OfflineQueue | null = null
let knownUser: { server: string; id: number } | null = null

/** The user id of the signed-in account, once something asked the server. Used to tell two users of one server apart. */
export function rememberKnownUser(serverUrl: string, userId: number): void {
  knownUser = { server: normalizeServerUrl(serverUrl), id: userId }
}

/** Signing out or in changes who the account is; the id is looked up again for the next one. */
export function forgetKnownUser(): void {
  knownUser = null
}

export function knownUserIdFor(serverUrl: string): number | undefined {
  return knownUser && knownUser.server === normalizeServerUrl(serverUrl) ? knownUser.id : undefined
}

/** The account the app is signed in to, or null when none is configured (standalone mode, logged out). */
export function currentOwner(): OfflineOwner | null {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return null
  const server = normalizeServerUrl(config.vikunja_url)
  const userId = knownUserIdFor(config.vikunja_url)
  return { server, ...(userId !== undefined ? { userId } : {}) }
}

/**
 * The process-wide offline queue. The first call splits a legacy `offline-cache.json`, reads the
 * queue file once and sweeps image files nothing refers to. Everything after that is in memory.
 */
export function getOfflineQueue(): OfflineQueue {
  if (queue) return queue

  const dir = app.getPath('userData')
  ensureLegacyMigration(dir)
  const created = new OfflineQueue({
    queuePath: join(dir, QUEUE_FILENAME),
    attachmentsDir: join(dir, OFFLINE_ATTACHMENTS_DIRNAME),
    getOwner: currentOwner,
  })
  const status = created.load()
  if (status === 'recovered') console.warn('[offline-queue] the queue file was damaged; restored the previous version from its backup')
  if (status === 'corrupt') console.warn('[offline-queue] the queue file was damaged and could not be restored; pending changes were lost')

  created.onChange(() => {
    // Cheap on purpose: this runs after every change, including each step of a long replay.
    const change: OfflineQueueChange = {
      counts: created.counts(),
      replaying: created.isReplaying(),
      authProblem: created.getAuthProblem(),
    }
    sendToAppWindows(OFFLINE_EVENTS.changed, change)
  })
  // Changes an older build queued carry no owner: they belong to whoever is signed in now.
  const owner = currentOwner()
  if (owner && created.stampUnowned(owner) > 0) console.log('[offline-queue] recorded the current server on actions queued before it was tracked')
  void created.sweepOrphans().catch((err) => console.warn('[offline-queue] image sweep failed:', err instanceof Error ? err.message : err))

  queue = created
  return created
}

/** Whether the queue has changes that are not on disk yet. Never creates the queue. */
export function offlineQueueHasUnsavedChanges(): boolean {
  return queue?.hasUnsavedChanges ?? false
}

export function flushOfflineQueue(): Promise<void> {
  return queue ? queue.flush() : Promise.resolve()
}
