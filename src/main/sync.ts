import { loadConfig } from './config'
import {
  fetchTasks,
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
import { matchesQueuedCreate } from './offline/duplicate-match'
import { createReplayRunner, replayQueue, type ReplayApi } from './offline/replay'
import { KEEP_NESTED_SUBTASKS_PARAM } from './api-v2'
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
  async findRecentCreate(projectId, fields, since) {
    const title = typeof fields.title === 'string' ? fields.title : ''
    const found = await fetchTasks({ q: title, filter: `project_id = ${projectId}`, [KEEP_NESTED_SUBTASKS_PARAM]: true })
    if (!found.success) return found
    return { success: true, data: found.data.find((t) => matchesQueuedCreate(t, projectId, fields, since)) as { id: number } | undefined ?? null }
  },
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
  try {
    return await runReplay()
  } catch (err) {
    // Callers fire this and forget it; a failure here must not become an unhandled rejection.
    console.warn('[sync] replay failed:', err instanceof Error ? err.message : err)
    return null
  }
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
