import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'

export function useTasks(params: TaskQueryParams, enabled = true) {
  return useQuery({
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
}
