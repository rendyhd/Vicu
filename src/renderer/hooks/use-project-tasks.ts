import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { sortProjectTasks } from '@/lib/task-sort'
import { mergeProjectUndoWindow } from '@/lib/undo-window'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'
import { useTaskOrder } from './use-task-order'
import { sortTasksByOrder } from '../../shared/task-order'

export function useProjectTasks(projectId: number | undefined) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)

  const viewQuery = useQuery({
    queryKey: ['project-views', projectId],
    queryFn: async () => {
      const result = await api.fetchProjectViews(projectId!)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: !!projectId,
    staleTime: Infinity,
    select: (views) => views.find((v) => v.view_kind === 'list'),
  })

  const tasksQuery = useQuery({
    queryKey: ['view-tasks', projectId, viewQuery.data?.id],
    queryFn: async () => {
      const result = await api.fetchViewTasks(projectId!, viewQuery.data!.id, {
        filter: 'done = false',
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: !!viewQuery.data?.id,
    // Hidden tasks stay out by their marker, not by `done = false` alone: one someone reopened in
    // the web UI is still hidden (cross-app semantics 10.1).
    select: (tasks) => sortProjectTasks(tasks.filter((task) => !hasVicuMetadataMarker(task.description))),
  })

  // The project's task order (cross-app semantics 12): its own, its parent's or the global one.
  const order = useTaskOrder(projectId)

  // Merge recently completed tasks back so they stay visible with strikethrough
  const data = useMemo(() => {
    const merged = mergeProjectUndoWindow(tasksQuery.data ?? [], completedTasks, pathname, projectId)
    // The cache is kept in the default order; another order sorts on display.
    return order === 'due_date_first' ? merged : sortTasksByOrder(merged, order)
  }, [tasksQuery.data, completedTasks, pathname, projectId, order])

  // Loading until the view is known too: the tasks query waits for it and would say "not loading",
  // so a list would mount, go to its skeleton and mount again, and lose what it had open.
  return { ...tasksQuery, isLoading: viewQuery.isLoading || tasksQuery.isLoading, data, viewId: viewQuery.data?.id, order }
}
