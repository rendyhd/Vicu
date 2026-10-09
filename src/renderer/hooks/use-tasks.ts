import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'
import { asksForOpenTasksOnly, dropReleasedCompletions, mergeSmartListUndoWindow } from '@/lib/undo-window'

export function useTasks(params: TaskQueryParams, enabled = true) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)

  const query = useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      // Without `page` the main process walks every page (honoring total_pages) and
      // removes nested subtasks once on the complete set. Paginating here would stop
      // early whenever a page shrank after subtask filtering (D-REN-1). Views that filter
      // first (Tag view, custom lists) pass `keep_nested_subtasks` to get the un-nested set.
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
    const loaded = (query.data ?? []).filter((task) => !hasVicuMetadataMarker(task.description))
    // An open-only query never returns a done task, so a done row is a completion that is still
    // held or that the hold has released (it leaves the list then).
    const tasks = asksForOpenTasksOnly(params.filter) ? dropReleasedCompletions(loaded, completedTasks, pathname) : loaded
    return mergeSmartListUndoWindow(tasks, completedTasks, pathname)
  }, [query.data, completedTasks, pathname, params])

  return { ...query, data }
}
