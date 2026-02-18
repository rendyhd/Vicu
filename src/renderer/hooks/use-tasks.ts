import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'

export function useTasks(params: TaskQueryParams, enabled = true) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)

  const query = useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      const result = await api.fetchTasks({
        per_page: DEFAULT_PAGE_SIZE,
        ...params,
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled,
  })

  // Merge recently toggled tasks back into results so they stay visible
  // until the user navigates away (undo window). This covers:
  // - Completed tasks shown with strikethrough in non-logbook views
  // - Uncompleted tasks shown without strikethrough in logbook
  const data = useMemo(() => {
    const tasks = query.data ?? []

    const serverIds = new Set(tasks.map((t) => t.id))
    const extras = Array.from(completedTasks.values())
      .filter((entry) => entry.path === pathname && !serverIds.has(entry.task.id))
      .map((entry) => entry.task)

    if (extras.length === 0) return tasks
    return [...tasks, ...extras]
  }, [query.data, completedTasks, pathname])

  return { ...query, data }
}
