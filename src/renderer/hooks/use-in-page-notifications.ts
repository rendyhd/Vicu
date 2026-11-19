import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { isWebHost } from '@/lib/capabilities'
import { openTaskInApp } from '@/lib/open-task'
import { toast } from '@/stores/toast-store'

/**
 * The web version: a reminder the browser would not show as a notification (permission not given,
 * or no notifications at all) arrives here and is shown as a toast, with Open for the task or page
 * it is about. The desktop never sends it.
 */
export function useInPageNotifications(): void {
  const navigate = useNavigate()
  const { t } = useTranslation()

  useEffect(() => {
    if (!isWebHost()) return
    return api.onInPageNotification((notice) => {
      const { taskId, route } = notice
      const open = taskId !== undefined
        ? () => void openTaskInApp(
            {
              fetchTask: (id) => api.fetchTaskById(id),
              inboxProjectId: async () => (await api.getConfig())?.inbox_project_id ?? 0,
              navigate: (to) => navigate(to),
              notify: (message) => toast.error(message),
            },
            taskId,
          )
        : route !== undefined
          ? () => navigate({ to: route })
          : undefined
      toast.info(notice.body ? `${notice.title}: ${notice.body}` : notice.title, {
        key: `in-page-notification:${taskId ?? route ?? notice.title}`,
        durationMs: 30_000,
        ...(open ? { action: { label: t('settings.notifications.inPageOpen'), onAction: open } } : {}),
      })
    })
  }, [navigate, t])
}
