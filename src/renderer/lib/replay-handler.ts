import type { QueryClient } from '@tanstack/react-query'
import type { OfflineReplayEvent } from '../../shared/offline-queue-types'
import { remapTempTaskIds } from './pending-cache'
import { invalidateTaskData } from './task-refresh'

export interface ReplayHandlerDeps {
  /** Move selection / undo-window state from temp ids to the real ids. */
  remapStores(idMap: ReadonlyMap<number, number>): void
  refreshReminders(): void
}

/**
 * The offline queue finished a replay (from any trigger, in the background too).
 *
 * - Tasks that were created offline have real ids now: swap them into the cache and the open view
 *   so an expanded or selected row keeps working.
 * - Once the queue is empty the server is the truth again, so refetch the task lists. While changes
 *   are still waiting the lists are left alone, otherwise the refetch would erase the optimistic
 *   state of the changes that are still queued.
 * - Anything that was applied can move reminders.
 */
export function handleReplayed(qc: QueryClient, event: OfflineReplayEvent, deps: ReplayHandlerDeps): void {
  const idMap = new Map<number, number>()
  for (const [temp, real] of Object.entries(event.idMap ?? {})) {
    const from = Number(temp)
    if (Number.isInteger(from) && from < 0 && real > 0) idMap.set(from, real)
  }
  if (idMap.size > 0) {
    remapTempTaskIds(qc, event.idMap)
    deps.remapStores(idMap)
  }

  if (event.counts.pending === 0 && (event.applied > 0 || event.failed > 0)) invalidateTaskData(qc)
  if (event.applied > 0) deps.refreshReminders()
}
