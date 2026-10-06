import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'

export function useTasks(params: TaskQueryParams, enabled = true) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)

  const query = useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      // Without `page` the main process walks every page (honoring total_pages) and
      // removes nested subtasks once on the complete set. Paginating here would stop
      // early whenever a page shrank after subtask filtering (D-REN-1).
      const result = await api.fetchTasks(params)
      if (!result.success) throw new Error(result.error)
      return result.data ?? []
    },
    enabled,
  })

  // Merge recently toggled tasks back into results so they stay visible
  // until the user navigates away (undo window). This covers:
  // - Completed tasks shown with strikethrough in non-logbook views
  // - Uncompleted tasks shown without strikethrough in logbook
  const data = useMemo(() => {
    const tasks = (query.data ?? []).filter((task) => !hasVicuMetadataMarker(task.description))

    const serverIds = new Set(tasks.map((t) => t.id))
    const extras = Array.from(completedTasks.values())
      .filter((entry) => entry.path === pathname && !entry.suppressTopLevelUndo && !serverIds.has(entry.task.id) && !hasVicuMetadataMarker(entry.task.description))
      .map((entry) => entry.task)

    if (extras.length === 0) return tasks
    return [...tasks, ...extras]
  }, [query.data, completedTasks, pathname])

  return { ...query, data }
}
