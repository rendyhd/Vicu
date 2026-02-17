import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'

export function useProjectTasks(projectId: number | undefined) {
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
    select: (tasks) => [...tasks].sort((a, b) => a.position - b.position),
  })

  return { ...tasksQuery, viewId: viewQuery.data?.id }
}
