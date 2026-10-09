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
import { OFFLINE_EVENTS, forgetKnownUser, getOfflineQueue, knownUserIdFor, rememberKnownUser, sendToAppWindows } from './offline/service'
import { fetchCurrentUser } from './auth/user-info'
import { authManager } from './auth/auth-manager'
import { getAPIToken } from './auth/token-store'
import { matchesQueuedCreate } from './offline/duplicate-match'
import { createReplayRunner, replayQueue, type ReplayApi } from './offline/replay'
import { sendSerially } from './offline/task-writes'
import { createReplayRetry } from './offline/replay-retry'
import { KEEP_NESTED_SUBTASKS_PARAM } from './api-v2'
import { invalidateViewerCaches } from './quick-entry/viewer-caches'
import { invalidateProjectCounts } from './project-counts-service'
import { getMainWindow, getQuickEntryWindow, getQuickViewWindow } from './quick-entry-state'
import type { OfflineReplayEvent } from '../shared/offline-queue-types'

// The replay's writes wait for the app's own task writes and the other way round (see sendSerially).
const api: ReplayApi = {
  createTask: (projectId, payload) => sendSerially(() => createTask(projectId, payload)),
  updateTask: (id, patch) => sendSerially(() => updateTask(id, patch)),
  deleteTask: (id) => sendSerially(() => deleteTask(id)),
  addLabelToTask: (taskId, labelId) => sendSerially(() => addLabelToTask(taskId, labelId)),
  removeLabelFromTask: (taskId, labelId) => sendSerially(() => removeLabelFromTask(taskId, labelId)),
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

// After a replay stopped on a server or network problem, try again soon instead of waiting for the
// next trigger (the five minute timer, a window resume or another write that got through).
const retry = createReplayRetry(() => {
  void replayPendingActions()
})

const runReplay = createReplayRunner(async () => {
  const event = await replayQueue(getOfflineQueue(), api)
  announce(event)
  return event
})

let userLookupAt = 0

/** The account changed (logout, login, new connection settings): the cached user id is no longer valid. */
export function accountChanged(): void {
  forgetKnownUser()
  userLookupAt = 0
  invalidateViewerCaches()
}

/**
 * Learn the signed-in user's id (once per server, at most once a minute while it fails), so the
 * queue can tell two users of one server apart. Best effort: without it the guard compares servers.
 */
export async function refreshKnownUser(): Promise<void> {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return
  if (knownUserIdFor(config.vikunja_url) !== undefined) return
  if (Date.now() - userLookupAt < 60_000) return
  userLookupAt = Date.now()
  const token = config.auth_method === 'api_token' ? (getAPIToken() || config.api_token) : authManager.getTokenSync()
  if (!token) return
  const user = await fetchCurrentUser(config.vikunja_url, token)
  if (user) rememberKnownUser(config.vikunja_url, user.id)
}

/**
 * Replay the offline queue (see src/main/offline/replay.ts for the rules). Safe to call from every
 * trigger: calls made while a replay is running join it, so nothing is sent twice. Resolves to
 * null when there is nothing to do (standalone mode, not configured, empty queue).
 */
export async function replayPendingActions(): Promise<OfflineReplayEvent | null> {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return null
  const queue = getOfflineQueue()
  // Actions stamped with a user id can only be compared once this session's user id is known, so
  // wait for it (a few seconds at most) before sending them. Otherwise look it up in the background.
  const needsUser = queue.getPending().some((a) => a.owner?.userId !== undefined)
  if (needsUser) await refreshKnownUser().catch(() => {})
  else void refreshKnownUser().catch(() => {})
  // After a logout or server switch, changes queued for the old account stop here, whatever
  // triggered this call.
  await queue.failForeign()
  if (queue.counts().pending === 0) {
    retry.afterReplay(null)
    return null
  }
  try {
    const event = await runReplay()
    retry.afterReplay(event)
    return event
  } catch (err) {
    // Callers fire this and forget it; a failure here must not become an unhandled rejection.
    console.warn('[sync] replay failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export function announce(event: OfflineReplayEvent): void {
  sendToAppWindows(OFFLINE_EVENTS.replayed, event)
  if (event.stopped === 'auth') sendToAppWindows(OFFLINE_EVENTS.authProblem, { error: event.error ?? 'Sign in again to sync your changes' })

  if (event.applied === 0 && event.failed === 0) return
  // Applied changes created, completed, moved or deleted tasks: the sidebar rings must count again
  // (the main window refetches its counts on 'tasks-changed' below, and would otherwise be served
  // the numbers cached before the offline period).
  if (event.applied > 0) invalidateProjectCounts()
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
