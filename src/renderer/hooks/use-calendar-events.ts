import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addLocalDays, startOfLocalDay, type LocalDate } from '../../shared/due-dates'
import type { CalendarEvent, CalendarEventsResult, CalendarFeedView } from '../../shared/calendar-events'

// Calendars on the Plan screen (proof of concept). Main reads the feeds; this asks for the days on
// screen and the connected calendars. Not in query-persistence's allowlist, so never saved to
// IndexedDB: events stay in main's memory.

const EVENTS_KEY = 'calendar-events'
const FEEDS_KEY = 'calendar-feeds'

const EMPTY: CalendarEvent[] = []

export function useCalendarEvents(days: readonly LocalDate[]): {
  events: CalendarEvent[]
  feeds: CalendarFeedView[]
  colorOf: (calendarId: string) => string | undefined
  countsAsBusy: (calendarId: string) => boolean
  /** A read is running: free time from it may still change. */
  isFetching: boolean
} {
  const from = days.length ? startOfLocalDay(days[0]).toISOString() : ''
  const to = days.length ? startOfLocalDay(addLocalDays(days[days.length - 1], 1)).toISOString() : ''
  const query = useQuery<CalendarEventsResult>({
    queryKey: [EVENTS_KEY, from, to],
    queryFn: () => window.api.calendar.events({ from, to }),
    enabled: days.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  })
  const feeds = query.data?.feeds ?? []
  return useMemo(() => {
    const byId = new Map(feeds.map((feed) => [feed.id, feed]))
    return {
      events: query.data?.events ?? EMPTY,
      feeds,
      colorOf: (id: string) => byId.get(id)?.color,
      countsAsBusy: (id: string) => byId.get(id)?.countsAsBusy !== false,
      isFetching: query.isFetching,
    }
  }, [query.data, query.isFetching])
}

export function useCalendarFeeds() {
  return useQuery<CalendarFeedView[]>({
    queryKey: [FEEDS_KEY],
    queryFn: () => window.api.calendar.list(),
  })
}

/** Add, change or remove a calendar; every view of events and feeds reads again. */
export function useCalendarFeedActions() {
  const client = useQueryClient()
  const after = (feeds?: CalendarFeedView[]) => {
    if (feeds) client.setQueryData([FEEDS_KEY], feeds)
    void client.invalidateQueries({ queryKey: [FEEDS_KEY] })
    void client.invalidateQueries({ queryKey: [EVENTS_KEY] })
  }
  const add = useMutation({
    mutationFn: async (input: { name: string; url: string; busyOnly?: boolean }) => {
      const result = await window.api.calendar.add(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: () => after(),
    meta: { silent: true },
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof window.api.calendar.update>[1] }) =>
      window.api.calendar.update(id, patch),
    onSuccess: after,
  })
  const remove = useMutation({
    mutationFn: (id: string) => window.api.calendar.remove(id),
    onSuccess: after,
  })
  const refresh = useMutation({
    mutationFn: () => window.api.calendar.refresh(),
    onSuccess: after,
  })
  return { add, update, remove, refresh }
}
