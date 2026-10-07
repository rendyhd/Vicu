import { create } from 'zustand'
import type { OfflineQueueChange, OfflineQueueSnapshot } from '../../shared/offline-queue-types'

/**
 * What the renderer knows about the main-process offline queue: how many changes are waiting or
 * failed, whether a replay is running, and which tasks they touch (for the row indicators).
 * `useOfflineQueueSync` keeps it current from the queue's events.
 */
interface OfflineState {
  counts: { pending: number; failed: number }
  replaying: boolean
  authProblem: { error: string; since: string } | null
  snapshot: OfflineQueueSnapshot | null
  /** Tasks with a change waiting to be sent, including tasks that only exist as a pending create (negative ids). */
  pendingTaskIds: ReadonlySet<number>
  /** Tasks whose change was rejected for good and sits in the failed log. */
  failedTaskIds: ReadonlySet<number>
  applyChange: (change: OfflineQueueChange) => void
  setSnapshot: (snapshot: OfflineQueueSnapshot) => void
}

const EMPTY: ReadonlySet<number> = new Set()

function taskIds(items: ReadonlyArray<{ taskId?: number }>): ReadonlySet<number> {
  const ids = new Set<number>()
  for (const item of items) if (typeof item.taskId === 'number') ids.add(item.taskId)
  return ids.size > 0 ? ids : EMPTY
}

export const useOfflineStore = create<OfflineState>((set) => ({
  counts: { pending: 0, failed: 0 },
  replaying: false,
  authProblem: null,
  snapshot: null,
  pendingTaskIds: EMPTY,
  failedTaskIds: EMPTY,
  applyChange: (change) =>
    set({ counts: change.counts, replaying: change.replaying, authProblem: change.authProblem }),
  setSnapshot: (snapshot) =>
    set({
      snapshot,
      counts: { pending: countPending(snapshot), failed: snapshot.failed.length },
      replaying: snapshot.replaying,
      authProblem: snapshot.authProblem,
      pendingTaskIds: taskIds(snapshot.pending),
      failedTaskIds: taskIds(snapshot.failed),
    }),
}))

/**
 * Pending changes as the user counts them: a task created offline is one change however many
 * labels and images ride along with it (the same rule as `OfflineQueue.counts`).
 */
export function countPending(snapshot: OfflineQueueSnapshot): number {
  const creates = new Set<number>()
  for (const item of snapshot.pending) if (item.create) creates.add(item.create.tempId)
  let pending = 0
  for (const item of snapshot.pending) {
    const followUp = (item.type === 'add-label' || item.type === 'upload-attachment') && item.taskId !== undefined && creates.has(item.taskId)
    if (!followUp) pending++
  }
  return pending
}
