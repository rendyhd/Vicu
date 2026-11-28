import { useCallback, useMemo } from 'react'
import type { LocalDate } from '../../shared/due-dates'
import { calendarCounts, eventBusyOfDay, type CalendarEvent, type CalendarFeedView } from '../../shared/calendar-events'
import { MY_EVENTS_CALENDAR_ID, MY_EVENTS_COLOR, type ListedEvent } from '../../shared/plan-events'
import type { BusyRange } from '../../shared/time-blocks'
import { useCalendarEvents } from './use-calendar-events'
import { usePlanEvents } from './use-plan-events'

export interface PlanBusy {
  /** Your own Events' occurrences and the connected calendars' events on the days, for the timeline. */
  events: CalendarEvent[]
  /** Your own Events, to change one that was pressed. */
  planEvents: ListedEvent[]
  feeds: CalendarFeedView[]
  eventColor: (calendarId: string) => string | undefined
  /** The busy time of a day's events (contract 20.2), without the day's blocks. */
  eventBusyOn: (day: LocalDate) => BusyRange[]
  /** The connected calendars are being read. */
  isFetching: boolean
}

/**
 * The events of the Plan screen and their busy time (contract 20.2), one source for the Plan views
 * and Plan my day: your Events always count (each says for itself), a connected calendar while it
 * is shown and counts as busy. Only free time ever leaves this: no title reaches the assistant.
 */
export function usePlanBusy(days: readonly LocalDate[]): PlanBusy {
  const calendar = useCalendarEvents(days)
  const own = usePlanEvents(days)
  const events = useMemo(() => [...own.occurrences, ...calendar.events], [own.occurrences, calendar.events])
  const counts = useMemo(() => calendarCounts(calendar.feeds), [calendar.feeds])
  const eventBusyOn = useCallback((day: LocalDate) => eventBusyOfDay(events, day, counts), [events, counts])
  const eventColor = useCallback(
    (id: string) => (id === MY_EVENTS_CALENDAR_ID ? MY_EVENTS_COLOR : calendar.colorOf(id)),
    [calendar],
  )
  return useMemo(
    () => ({ events, planEvents: own.events, feeds: calendar.feeds, eventColor, eventBusyOn, isFetching: calendar.isFetching }),
    [events, own.events, calendar.feeds, eventColor, eventBusyOn, calendar.isFetching],
  )
}
