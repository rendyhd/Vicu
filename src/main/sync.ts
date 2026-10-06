import { loadConfig } from './config'
import {
  addLabelToTask,
  createLabel,
  createTask,
  deleteTask,
  fetchLabels,
  fetchTaskAttachments,
  fetchTaskById,
  removeLabelFromTask,
  updateTask,
  uploadTaskAttachment,
} from './api-client'
import { OFFLINE_EVENTS, getOfflineQueue, sendToAppWindows } from './offline/service'
import { createReplayRunner, replayQueue, type ReplayApi } from './offline/replay'
import { getMainWindow, getQuickEntryWindow, getQuickViewWindow } from './quick-entry-state'
import type { OfflineReplayEvent } from '../shared/offline-queue-types'

const api: ReplayApi = {
  createTask,
  updateTask,
  deleteTask,
  addLabelToTask,
  removeLabelFromTask,
  fetchLabels,
  createLabel,
  uploadTaskAttachment,
  fetchTaskAttachments,
  fetchTaskById,
}

const runReplay = createReplayRunner(async () => {
  const event = await replayQueue(getOfflineQueue(), api)
  announce(event)
  return event
})

/**
 * Replay the offline queue (see src/main/offline/replay.ts for the rules). Safe to call from every
 * trigger: calls made while a replay is running join it, so nothing is sent twice. Resolves to
 * null when there is nothing to do (standalone mode, not configured, empty queue).
 */
export async function replayPendingActions(): Promise<OfflineReplayEvent | null> {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return null
  if (getOfflineQueue().counts().pending === 0) return null
  return runReplay()
}

function announce(event: OfflineReplayEvent): void {
  sendToAppWindows(OFFLINE_EVENTS.replayed, event)
  if (event.stopped === 'auth') sendToAppWindows(OFFLINE_EVENTS.authProblem, { error: event.error ?? 'Sign in again to sync your changes' })

  if (event.applied === 0 && event.failed === 0) return
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed() && event.applied > 0) win.webContents.send('tasks-changed')
  } catch { /* ignore */ }
  // Quick Entry shows the pending count, Quick View refetches its list.
  for (const get of [getQuickViewWindow, getQuickEntryWindow]) {
    try {
      const win = get()
      if (win && !win.isDestroyed()) win.webContents.send('sync-completed')
    } catch { /* ignore */ }
  }
}
