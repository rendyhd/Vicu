import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'

export function useSubtasks(taskId: number | null) {
  return useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: async () => {
      const result = await api.fetchTaskById(taskId!)
      if (!result.success) throw new Error(result.error)
      const task = result.data as Task
      return (task.related_tasks?.subtask as Task[] | undefined) ?? []
    },
    enabled: taskId !== null,
  })
}
