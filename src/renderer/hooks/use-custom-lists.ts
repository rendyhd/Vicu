import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { CustomList, CustomListSyncStatus } from '@/lib/vikunja-types'

export const CUSTOM_LISTS_QUERY_KEY = ['custom-lists'] as const
export const CUSTOM_LIST_SYNC_STATUS_QUERY_KEY = ['custom-list-sync-status'] as const

function useCustomListEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => api.onCustomListsChanged((lists) => {
    queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, lists)
  }), [queryClient])
  useEffect(() => api.onCustomListSyncStatus((status) => {
    queryClient.setQueryData(CUSTOM_LIST_SYNC_STATUS_QUERY_KEY, status)
  }), [queryClient])
  useEffect(() => {
    const handleOnline = () => {
      void api.syncCustomLists().then((status) => {
        queryClient.setQueryData(CUSTOM_LIST_SYNC_STATUS_QUERY_KEY, status)
      })
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [queryClient])
}

export function useCustomLists() {
  useCustomListEvents()
  return useQuery({
    queryKey: CUSTOM_LISTS_QUERY_KEY,
    queryFn: () => api.getCustomLists(),
    staleTime: Infinity,
  })
}

export function useCustomList(id: string) {
  const query = useCustomLists()
  return { ...query, data: query.data?.find((list) => list.id === id) }
}

export function useCustomListSyncStatus() {
  useCustomListEvents()
  return useQuery<CustomListSyncStatus>({
    queryKey: CUSTOM_LIST_SYNC_STATUS_QUERY_KEY,
    queryFn: () => api.getCustomListSyncStatus(),
    staleTime: Infinity,
  })
}

export function useUpsertCustomList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (list: CustomList) => api.upsertCustomList(list),
    onMutate: async (list) => {
      await queryClient.cancelQueries({ queryKey: CUSTOM_LISTS_QUERY_KEY })
      const previous = queryClient.getQueryData<CustomList[]>(CUSTOM_LISTS_QUERY_KEY)
      if (previous) {
        const index = previous.findIndex((entry) => entry.id === list.id)
        queryClient.setQueryData(
          CUSTOM_LISTS_QUERY_KEY,
          index >= 0 ? previous.map((entry) => entry.id === list.id ? list : entry) : [...previous, list],
        )
      }
      return { previous }
    },
    onError: (_error, _list, context) => {
      if (context?.previous) queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, context.previous)
    },
    onSuccess: (lists) => queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, lists),
  })
}

export function useDeleteCustomList() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCustomList(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: CUSTOM_LISTS_QUERY_KEY })
      const previous = queryClient.getQueryData<CustomList[]>(CUSTOM_LISTS_QUERY_KEY)
      if (previous) queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, previous.filter((list) => list.id !== id))
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, context.previous)
    },
    onSuccess: (lists) => queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, lists),
  })
}

export function useReorderCustomLists() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderCustomLists(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: CUSTOM_LISTS_QUERY_KEY })
      const previous = queryClient.getQueryData<CustomList[]>(CUSTOM_LISTS_QUERY_KEY)
      if (previous) {
        const byId = new Map(previous.map((list) => [list.id, list]))
        queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, ids.map((id) => byId.get(id)).filter(Boolean))
      }
      return { previous }
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, context.previous)
    },
    onSuccess: (lists) => queryClient.setQueryData(CUSTOM_LISTS_QUERY_KEY, lists),
  })
}

export function useSyncCustomLists() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.syncCustomLists(),
    onSuccess: (status) => queryClient.setQueryData(CUSTOM_LIST_SYNC_STATUS_QUERY_KEY, status),
  })
}
