import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { CalDavEventsResult } from '../../shared/caldav-types'
import { addLocalDays, startOfLocalDay } from '@/lib/due-dates'

export const CALDAV_QUERY_KEY = ['caldav'] as const

export function useCalDavEvents(day: string) {
  const start = startOfLocalDay(day).toISOString()
  const end = startOfLocalDay(addLocalDays(day, 1)).toISOString()
  return useQuery({
    queryKey: [...CALDAV_QUERY_KEY, 'events', start, end],
    queryFn: () => api.caldav.events(start, end),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  })
}

export function useUpdateCalDavEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.caldav.update,
    onMutate: async (update) => {
      const queryKey = [...CALDAV_QUERY_KEY, 'events']
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueriesData<CalDavEventsResult>({ queryKey })
      queryClient.setQueriesData<CalDavEventsResult>({ queryKey }, (current) => current ? {
        ...current, events: current.events.map((event) => event.id === update.id ? { ...event, start: update.start, end: update.end } : event),
      } : current)
      return previous
    },
    onError: (_error, _update, previous) => {
      for (const [key, value] of previous ?? []) queryClient.setQueryData(key, value)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...CALDAV_QUERY_KEY, 'events'] }),
  })
}
