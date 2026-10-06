import { app } from 'electron'
import { join } from 'path'
import type { OfflineQueueChange } from '../../shared/offline-queue-types'
import { getMainWindow, getQuickEntryWindow, getQuickViewWindow } from '../quick-entry-state'
import { OFFLINE_ATTACHMENTS_DIRNAME } from './attachments'
import { QUEUE_FILENAME, ensureLegacyMigration } from './legacy-migration'
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
  })
  const status = created.load()
  if (status === 'recovered') console.warn('[offline-queue] the queue file was damaged; restored the previous version from its backup')
  if (status === 'corrupt') console.warn('[offline-queue] the queue file was damaged and could not be restored; pending changes were lost')

  created.onChange(() => {
    const snapshot = created.snapshot()
    const change: OfflineQueueChange = {
      counts: created.counts(),
      replaying: snapshot.replaying,
      authProblem: snapshot.authProblem,
    }
    sendToAppWindows(OFFLINE_EVENTS.changed, change)
  })
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
