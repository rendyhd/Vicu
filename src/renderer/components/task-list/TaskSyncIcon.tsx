import { AlertTriangle, CloudOff } from 'lucide-react'
import { useOfflineStore } from '@/stores/offline-store'

/**
 * A small marker on a task row whose change has not reached the server: waiting in the offline
 * queue (including a task that only exists as a pending create), or rejected for good and sitting
 * in the failed log (D-SYNC-6). Renders nothing for a synced task.
 */
export function TaskSyncIcon({ taskId }: { taskId: number }) {
  // A negative id is a task created offline: pending by definition, even before the queue snapshot arrives.
  const pending = useOfflineStore((s) => taskId < 0 || s.pendingTaskIds.has(taskId))
  const failed = useOfflineStore((s) => s.failedTaskIds.has(taskId))

  if (failed) {
    return (
      <span title="A change to this task could not be synced. Open the sync panel in the sidebar to retry or discard it." className="shrink-0 text-accent-red">
        <AlertTriangle className="h-3 w-3" aria-label="Sync failed" />
      </span>
    )
  }
  if (pending) {
    return (
      <span title="Waiting to sync. It is saved on this computer." className="shrink-0 text-[var(--text-secondary)]">
        <CloudOff className="h-3 w-3" aria-label="Waiting to sync" />
      </span>
    )
  }
  return null
}
