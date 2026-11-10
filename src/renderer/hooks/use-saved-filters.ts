import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { SavedFilterState } from '../../shared/saved-filter-import'

export const SAVED_FILTERS_QUERY_KEY = ['saved-filters'] as const

/**
 * The account's Vikunja saved filters as this device knows them (cross-app semantics 3.7): the
 * known filters, the ones Settings offers, and the imported lists whose first-open notice was
 * closed. The main process tells the windows when it changes.
 */
export function useSavedFilters() {
  const queryClient = useQueryClient()
  useEffect(() => api.onSavedFiltersChanged((state) => {
    queryClient.setQueryData(SAVED_FILTERS_QUERY_KEY, state)
  }), [queryClient])
  return useQuery<SavedFilterState>({
    queryKey: SAVED_FILTERS_QUERY_KEY,
    queryFn: () => api.getSavedFilterState(),
    staleTime: Infinity,
  })
}
