// Calendar events on the Plan screen (contract section 20). An event of a connected calendar is
// read-only: Vicu shows it and counts it as busy time (20.2), and never writes it back. Your own
// Events (plan-events.ts) become events of the same shape. Pinned by the `eventBusy` vectors of
// cross-app-semantics-v1.json. Pure: no Electron, no DOM, the clock is passed in.

import { addLocalDays, startOfLocalDay, type LocalDate } from './due-dates'
import type { BusyRange } from './time-blocks'

/** The calendar id of your own Events (plan-events.ts has the rest). */
export const MY_EVENTS_CALENDAR_ID = 'vicu:events'

/** One occurrence of a calendar event, recurrence already expanded. */
export interface CalendarEvent {
  /** Unique per occurrence: the feed, the UID and the occurrence's start. */
  id: string
  calendarId: string
  title: string
  location?: string
  /** ISO instants. An all-day event runs from local midnight to the local midnight after its last day. */
  start: string
  end: string
  allDay: boolean
  /** Opaque (busy) or transparent (free, TRANSP:TRANSPARENT). */
  busy: boolean
  tentative: boolean
  /** One of your own Events (plan-events.ts): its synced id and the day of this occurrence. */
  planEventId?: string
  day?: string
}

/** A connected calendar as the windows see it: never its address, which is a secret. */
export interface CalendarFeedView {
  id: string
  /** The connection (a calendar link, a CalDAV account) it belongs to. */
  connectionId: string
  name: string
  /** #rrggbb */
  color: string
  /** Shown on the timeline (contract 20.9 "Shown"); off, it is not read and counts for nothing. */
  enabled: boolean
  /** Show only "Busy" instead of the event's title (the work-calendar mode). */
  busyOnly: boolean
  /** Whether its events count as busy time for free time, Fit and Plan my day. */
  countsAsBusy: boolean
  /** When it was last read successfully, ISO. */
  fetchedAt?: string
  /** Why the last read failed; the last good copy stays on screen (20.9). */
  error?: string
  /** Something to know that is not a failure, such as a limit that cut the events short. */
  warning?: string
}

export interface CalendarEventsResult {
  events: CalendarEvent[]
  feeds: CalendarFeedView[]
}

/** Default colours for new calendars, in order. */
export const CALENDAR_COLORS = ['#7c6cf2', '#0a84ff', '#30a46c', '#e5484d', '#f76b15', '#12a594'] as const
/** Their names, in the same order, for the colour choice. */
export const CALENDAR_COLOR_NAMES = ['Purple', 'Blue', 'Green', 'Red', 'Orange', 'Teal'] as const

/** webcal:// is https:// (a subscription link); anything else must be http or https. */
export function normaliseFeedUrl(input: string): string | null {
  const trimmed = input.trim()
  const url = trimmed.replace(/^webcals?:\/\//i, 'https://')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

/** Minutes from the local midnight of `day`, clipped to that day: [start, end) or null when it misses the day. */
export function eventMinutesOn(event: Pick<CalendarEvent, 'start' | 'end'>, day: LocalDate): [number, number] | null {
  const dayStart = startOfLocalDay(day).getTime()
  const dayEnd = startOfLocalDay(addLocalDays(day, 1)).getTime()
  const start = Math.max(new Date(event.start).getTime(), dayStart)
  const end = Math.min(new Date(event.end).getTime(), dayEnd)
  if (end <= start) return null
  // Wall-clock minutes, so a day with a clock change still lines up with the grid's hour lines.
  const toMinute = (ms: number) => (ms >= dayEnd ? 24 * 60 : new Date(ms).getHours() * 60 + new Date(ms).getMinutes())
  const from = toMinute(start)
  const to = toMinute(end)
  return to > from ? [from, to] : null
}

/** The timed events that touch `day` (an all-day event is not on the grid). */
export function timedEventsOn<E extends CalendarEvent>(events: readonly E[], day: LocalDate): { event: E; startMinute: number; endMinute: number }[] {
  const placed: { event: E; startMinute: number; endMinute: number }[] = []
  for (const event of events) {
    if (event.allDay) continue
    const minutes = eventMinutesOn(event, day)
    if (minutes) placed.push({ event, startMinute: minutes[0], endMinute: minutes[1] })
  }
  return placed
}

/** The all-day events on `day`, for the row above the timeline. */
export function allDayEventsOn<E extends CalendarEvent>(events: readonly E[], day: LocalDate): E[] {
  return events.filter((event) => event.allDay && eventMinutesOn(event, day) !== null)
}

/**
 * Busy only (20.8): the title becomes "Busy", or "Free" for a free event, and the place is dropped.
 * Done before anything is stored or drawn.
 */
export function busyOnlyEvent<E extends CalendarEvent>(event: E): E {
  const { location: _location, ...rest } = event
  return { ...rest, title: event.busy ? 'Busy' : 'Free' } as E
}

/**
 * Which calendars count as busy (20.2): your own Events always (each Event says for itself), a
 * connected calendar while it is shown and counts as busy.
 */
export function calendarCounts(
  feeds: readonly Pick<CalendarFeedView, 'id' | 'enabled' | 'countsAsBusy'>[],
): (calendarId: string) => boolean {
  const counting = new Set(feeds.filter((feed) => feed.enabled && feed.countsAsBusy).map((feed) => feed.id))
  return (calendarId) => calendarId === MY_EVENTS_CALENDAR_ID || counting.has(calendarId)
}

/**
 * Busy time from calendars on `day`: timed, busy (opaque) events of calendars that count. All-day
 * events are not busy (a holiday or a birthday does not fill the day); tentative ones are.
 */
export function eventBusyOfDay(
  events: readonly CalendarEvent[],
  day: LocalDate,
  counts: (calendarId: string) => boolean = () => true,
): BusyRange[] {
  const ranges: BusyRange[] = []
  for (const { event, startMinute, endMinute } of timedEventsOn(events, day)) {
    if (!event.busy || !counts(event.calendarId)) continue
    ranges.push([startMinute, endMinute])
  }
  return ranges
}
