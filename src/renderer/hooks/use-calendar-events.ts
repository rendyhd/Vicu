import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { addLocalDays, startOfLocalDay, type LocalDate } from '../../shared/due-dates'
import type { CalendarEvent, CalendarEventsResult, CalendarFeedView } from '../../shared/calendar-events'
import type { AddCalendarLinkInput, CaldavDiscoverInput, CaldavSaveInput, CalendarSourcesView } from '../../shared/calendar-sources'

// Connected calendars on the Plan screen (contract 20.9). Main reads them; this asks for the days on
// screen and the connections. Not in query-persistence's allowlist, so never saved to IndexedDB:
// events stay in main (its memory and its encrypted last good copy).
//
// When they are read again: main reads a calendar at most every 5 minutes when asked. This asks on
// view, every 5 minutes, on window focus, when main says a background read brought something new
// (`calendar-changed`), and on a manual refresh (F5, Mod+R, the palette), which forces a read.

export const CALENDAR_EVENTS_KEY = 'calendar-events'
export const CALENDAR_SOURCES_KEY = 'calendar-sources'

const EMPTY: CalendarEvent[] = []

/** Ask every view of calendars to read again (main decides whether the servers are asked). */
export function invalidateCalendars(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: [CALENDAR_SOURCES_KEY] })
  void client.invalidateQueries({ queryKey: [CALENDAR_EVENTS_KEY] })
}

export function useCalendarEvents(days: readonly LocalDate[]): {
  events: CalendarEvent[]
  feeds: CalendarFeedView[]
  colorOf: (calendarId: string) => string | undefined
  countsAsBusy: (calendarId: string) => boolean
  /** A read is running: free time from it may still change. */
  isFetching: boolean
} {
  const client = useQueryClient()
  const from = days.length ? startOfLocalDay(days[0]).toISOString() : ''
  const to = days.length ? startOfLocalDay(addLocalDays(days[days.length - 1], 1)).toISOString() : ''
  const query = useQuery<CalendarEventsResult>({
    queryKey: [CALENDAR_EVENTS_KEY, from, to],
    queryFn: () => window.api.calendar.events({ from, to }),
    enabled: days.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  })

  useEffect(() => {
    // An Electron window that only loses focus never changes page visibility, so TanStack's own
    // focus refetch never runs; main keeps its 5-minute rule.
    const onFocus = () => void client.invalidateQueries({ queryKey: [CALENDAR_EVENTS_KEY] })
    window.addEventListener('focus', onFocus)
    const off = window.api.calendar.onChanged(() => invalidateCalendars(client))
    return () => {
      window.removeEventListener('focus', onFocus)
      off()
    }
  }, [client])

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

/** The connections and their calendars, for the settings. */
export function useCalendarSources() {
  return useQuery<CalendarSourcesView>({
    queryKey: [CALENDAR_SOURCES_KEY],
    queryFn: () => window.api.calendar.list(),
  })
}

/** Add, change or remove calendars; every view of events and connections reads again. */
export function useCalendarActions() {
  const client = useQueryClient()
  const after = (view?: CalendarSourcesView) => {
    if (view) client.setQueryData([CALENDAR_SOURCES_KEY], view)
    invalidateCalendars(client)
  }
  const add = useMutation({
    mutationFn: async (input: AddCalendarLinkInput) => {
      const result = await window.api.calendar.add(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: () => after(),
    meta: { silent: true },
  })
  const discover = useMutation({
    mutationFn: async (input: CaldavDiscoverInput) => {
      const result = await window.api.calendar.caldavDiscover(input)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    meta: { silent: true },
  })
  const saveAccount = useMutation({
    mutationFn: async ({ draftId, input }: { draftId: string; input: CaldavSaveInput }) => {
      const result = await window.api.calendar.caldavSave(draftId, input)
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
    mutationFn: (connectionId: string) => window.api.calendar.remove(connectionId),
    onSuccess: after,
  })
  const refresh = useMutation({
    mutationFn: (connectionId?: string) => window.api.calendar.refresh(connectionId),
    onSuccess: after,
  })
  return { add, discover, saveAccount, update, remove, refresh }
}
