import { AlertTriangle, CloudOff } from 'lucide-react'
import { useOfflineStore } from '@/stores/offline-store'
import { useTranslation } from 'react-i18next'

/**
 * A small marker on a task row whose change has not reached the server: waiting in the offline
 * queue (including a task that only exists as a pending create), or rejected for good and sitting
 * in the failed log (D-SYNC-6). Renders nothing for a synced task.
 */
export function TaskSyncIcon({ taskId }: { taskId: number }) {
  const { t } = useTranslation()
  // A negative id is a task created offline: pending by definition, even before the queue snapshot arrives.
  const pending = useOfflineStore((s) => taskId < 0 || s.pendingTaskIds.has(taskId))
  const failed = useOfflineStore((s) => s.failedTaskIds.has(taskId))

  if (failed) {
    return (
      <span title={t('task.sync.failedTitle')} className="shrink-0 text-danger">
        <AlertTriangle className="h-3 w-3" aria-label={t('task.sync.failed')} />
      </span>
    )
  }
  if (pending) {
    return (
      <span title={t('task.sync.waitingTitle')} className="shrink-0 text-[var(--text-secondary)]">
        <CloudOff className="h-3 w-3" aria-label={t('task.sync.waiting')} />
      </span>
    )
  }
  return null
}
