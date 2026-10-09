import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { openTaskInApp } from '@/lib/open-task'
import { toast } from '@/stores/toast-store'

/** Shows a task in this window: its list opens and the row expands (Quick find, the command palette). */
export function useOpenTask(): (taskId: number) => void {
  const navigate = useNavigate()
  return useCallback(
    (taskId: number) => {
      void openTaskInApp(
        {
          fetchTask: (id) => api.fetchTaskById(id),
          inboxProjectId: async () => (await api.getConfig())?.inbox_project_id ?? 0,
          navigate: (route) => navigate(route),
          notify: (message) => toast.error(message),
        },
        taskId,
      )
    },
    [navigate],
  )
}
