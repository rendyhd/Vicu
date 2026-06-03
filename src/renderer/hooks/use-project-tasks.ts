import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import { sortProjectTasks } from '@/lib/task-sort'
import { evictForeignCompletions } from '@/lib/undo-window'

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
        per_page: DEFAULT_PAGE_SIZE,
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled: !!viewQuery.data?.id,
    select: (tasks) => sortProjectTasks(tasks),
  })

  // Merge recently completed tasks back so they stay visible with strikethrough
  const data = useMemo(() => {
    const tasks = tasksQuery.data ?? []
    // Drop tasks completed on another path — their optimistic done:true leaked
    // into this cache (e.g. a parent project completion lingering in this
    // subproject's view, or vice versa). The undo window belongs to one path.
    const visible = evictForeignCompletions(tasks, completedTasks, pathname)
    const serverIds = new Set(visible.map((t) => t.id))
    const extras = Array.from(completedTasks.values())
      .filter((entry) => entry.path === pathname && !serverIds.has(entry.task.id))
      .map((entry) => entry.task)

    if (visible === tasks && extras.length === 0) return tasks
    return sortProjectTasks([...visible, ...extras])
  }, [tasksQuery.data, completedTasks, pathname])

  return { ...tasksQuery, data, viewId: viewQuery.data?.id }
}
