import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'
import { rankTasks } from '@/lib/search-ranking'

export function useSearchTasks(query: string) {
  return useQuery({
    queryKey: ['tasks', 'search', query],
    queryFn: async () => {
      // The server-side search is a pre-filter; every match is ranked client-side, so the whole set
      // is read, in full pages (1000 is the server maximum).
      const result = await api.fetchTasks({
        q: query,
        per_page: 1000,
      })
      if (!result.success) throw new Error(result.error)

      const visibleTasks = result.data.filter((task) => !hasVicuMetadataMarker(task.description))
      return rankTasks(visibleTasks, query)
    },
    enabled: !!query && query.length > 0,
  })
}
