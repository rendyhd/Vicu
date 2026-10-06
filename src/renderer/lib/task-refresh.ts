import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { api } from './api'
import { useOfflineStore } from '@/stores/offline-store'

/** Every cached query that holds tasks or something derived from them. */
export const TASK_QUERY_KEYS: readonly QueryKey[] = [['tasks'], ['view-tasks'], ['section-tasks'], ['task-detail']]

/** Plus what depends on the date: carriers behind the routines list. */
export const DATE_QUERY_KEYS: readonly QueryKey[] = [...TASK_QUERY_KEYS, ['routines']]

export function invalidateTaskData(qc: QueryClient, keys: readonly QueryKey[] = TASK_QUERY_KEYS): void {
  for (const queryKey of keys) qc.invalidateQueries({ queryKey })
}

export function invalidateDateDependentData(qc: QueryClient): void {
  invalidateTaskData(qc, DATE_QUERY_KEYS)
}

export interface RefreshDeps {
  /** Changes waiting in the offline queue. */
  pendingCount(): number
  /** Ask the main process to replay the queue now; fire and forget. */
  replayNow(): void
}

/**
 * Refetch the task lists, unless the offline queue still holds changes the server has not seen.
 *
 * A refetch would replace the optimistic cache with the server's version and the queued edits would
 * seem to vanish until the replay lands. So while changes are waiting the lists are left alone and a
 * replay is requested; when it drains the queue, the replay handler invalidates them. A replay that
 * cannot send anything (offline) leaves the optimistic cache as the best picture there is.
 */
export function refreshTaskData(
  qc: QueryClient,
  deps: RefreshDeps,
  keys: readonly QueryKey[] = TASK_QUERY_KEYS,
): 'refreshed' | 'deferred' {
  if (deps.pendingCount() > 0) {
    deps.replayNow()
    return 'deferred'
  }
  invalidateTaskData(qc, keys)
  return 'refreshed'
}

/** The main process single-flights replays; this only keeps a burst of refreshes from asking over and over. */
const REPLAY_REQUEST_MIN_INTERVAL_MS = 5_000
let lastReplayRequest = 0

export const appRefreshDeps: RefreshDeps = {
  pendingCount: () => useOfflineStore.getState().counts.pending,
  replayNow: () => {
    const now = Date.now()
    if (now - lastReplayRequest < REPLAY_REQUEST_MIN_INTERVAL_MS) return
    lastReplayRequest = now
    void Promise.resolve(api.offlineQueue.replayNow()).catch(() => {})
  },
}

/** `refreshTaskData` with the app's own queue state: what every mutation and refresh trigger calls. */
export function refreshTasks(qc: QueryClient, keys?: readonly QueryKey[]): 'refreshed' | 'deferred' {
  return refreshTaskData(qc, appRefreshDeps, keys)
}
