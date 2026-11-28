import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { DATE_QUERY_KEYS, refreshTaskData, type RefreshDeps } from './task-refresh'

// Refresh on request (F5, Mod+R, View → Refresh, the command palette): read the page again from the
// server without leaving it. The automatic refreshes (lib/freshness.ts) only refetch tasks and are
// throttled; this one is not throttled and also rereads projects, labels, sharing, the synced
// documents (custom lists, synced preferences) and the connected calendars, so a change made on
// another device or in a calendar shows at once.

/** What a refresh rereads besides the tasks. */
export const MANUAL_REFRESH_KEYS: readonly QueryKey[] = [
  ['projects'],
  ['labels'],
  ['project-views'],
  ['project-members'],
  ['project-shares'],
  ['task-comments'],
]

export interface ManualRefreshDeps extends RefreshDeps {
  /** Ask main to sync the custom lists and the synced preferences; fire and forget. */
  syncDocuments(): void
  /** Ask main to read the connected calendars now (contract 20.9), then the Plan screen again. */
  refreshCalendars(): void
}

/**
 * Reread everything the page shows. Tasks follow the usual rule (lib/task-refresh.ts): while the
 * offline queue holds changes a replay is asked for instead, and the lists refetch when it drains.
 */
export function manualRefresh(qc: QueryClient, deps: ManualRefreshDeps): 'refreshed' | 'deferred' {
  for (const queryKey of MANUAL_REFRESH_KEYS) void qc.invalidateQueries({ queryKey })
  deps.syncDocuments()
  deps.refreshCalendars()
  return refreshTaskData(qc, deps, DATE_QUERY_KEYS)
}

/** F5 anywhere in the main window (Mod+R comes through the View menu). */
export function isRefreshKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return event.key === 'F5' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
}
