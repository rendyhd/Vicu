import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { hasVicuMetadataMarker } from '@/lib/metadata-tasks'
import { rankTasks } from '@/lib/search-ranking'
import { buildSearchServerFilter, matchesSearchFilters, searchFiltersActive, type SearchFilters } from '../../shared/search-filters'

export function useSearchTasks(query: string, filters: SearchFilters = {}) {
  return useQuery({
    queryKey: ['tasks', 'search', query, filters],
    queryFn: async () => {
      // The server-side search is a pre-filter; every match is ranked client-side, so the whole set
      // is read, in full pages (1000 is the server maximum).
      const filter = buildSearchServerFilter(filters, !!query)
      const result = await api.fetchTasks({
        ...(query ? { q: query } : {}),
        ...(filter ? { filter } : {}),
        per_page: 1000,
      })
      if (!result.success) throw new Error(result.error)

      const visibleTasks = result.data.filter((task) => !hasVicuMetadataMarker(task.description) && matchesSearchFilters(task, filters))
      return query ? rankTasks(visibleTasks, query) : visibleTasks
    },
    enabled: !!query || searchFiltersActive(filters),
  })
}
