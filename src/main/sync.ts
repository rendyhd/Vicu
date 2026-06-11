import { loadConfig } from './config'
import { createTask, updateTask } from './api-client'
import { getPendingActions, removePendingAction, isRetriableError } from './cache'
import { actionToRequest } from './sync-logic'
import { getMainWindow, getQuickViewWindow } from './quick-entry-state'

let replaying = false

/**
 * Replay queued offline actions FIFO. Stops at the first retriable
 * (still-offline) failure to preserve ordering; drops actions that fail
 * permanently (404 task deleted, validation error) so the queue can't jam.
 * Safe to call from multiple triggers — concurrent calls no-op.
 */
export async function replayPendingActions(): Promise<void> {
  if (replaying) return
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return

  replaying = true
  let applied = 0
  try {
    for (const action of getPendingActions()) {
      const req = actionToRequest(action)
      if (req.kind === 'skip') {
        removePendingAction(action.id)
        continue
      }
      const result = req.kind === 'create'
        ? await createTask(req.projectId, req.payload)
        : await updateTask(req.taskId, req.payload)

      if (result.success) {
        removePendingAction(action.id)
        applied++
      } else if (isRetriableError(result.error)) {
        break // still offline — keep the action and stop, order preserved
      } else {
        console.warn(`[sync] dropping pending action ${action.id} (${action.type}): ${result.error}`)
        removePendingAction(action.id)
      }
    }
  } finally {
    replaying = false
  }

  if (applied > 0) notifyWindowsAfterReplay()
}

function notifyWindowsAfterReplay(): void {
  try {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send('tasks-changed')
  } catch { /* ignore */ }
  try {
    const viewer = getQuickViewWindow()
    if (viewer && !viewer.isDestroyed()) viewer.webContents.send('sync-completed')
  } catch { /* ignore */ }
}
