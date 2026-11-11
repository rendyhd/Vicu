// Reading an iCalendar (RFC 5545) feed into the occurrences of a time range (proof of concept).
// ical.js (Mozilla's parser, the one Thunderbird uses) does the parsing, the time zones and the
// recurrence: RRULE, RDATE, EXDATE and RECURRENCE-ID overrides. Free of Electron so it can be tested.

import ICAL from 'ical.js'
import type { CalendarEvent } from '../../shared/calendar-events'

/** A parsed feed, kept so a new range does not parse the text again. */
export interface ParsedFeed {
  events: ICAL.Event[]
}

/** Occurrences looked at per recurring event at most, so a broken rule cannot hang the main process. */
const MAX_OCCURRENCES = 20_000

export function parseIcs(text: string): ParsedFeed {
  const root = new ICAL.Component(ICAL.parse(text))
  // The feed's own VTIMEZONEs first: Outlook names its zones the Windows way ("W. Europe Standard Time").
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const timezone = new ICAL.Timezone(zone)
    if (timezone.tzid && !ICAL.TimezoneService.has(timezone.tzid)) ICAL.TimezoneService.register(timezone)
  }

  // An override (RECURRENCE-ID) belongs to its series; one without a series stands on its own.
  const masters = new Map<string, ICAL.Event>()
  const overrides: ICAL.Event[] = []
  for (const component of root.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException()) overrides.push(event)
    else masters.set(event.uid, event)
  }
  const standalone: ICAL.Event[] = []
  for (const override of overrides) {
    const master = masters.get(override.uid)
    if (master) master.relateException(override)
    else standalone.push(override)
  }
  return { events: [...masters.values(), ...standalone] }
}

function statusOf(component: ICAL.Component): string {
  return String(component.getFirstPropertyValue('status') ?? '').toUpperCase()
}

function toEvent(
  calendarId: string,
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time,
): CalendarEvent | null {
  const component = item.component
  if (statusOf(component) === 'CANCELLED') return null
  const allDay = start.isDate
  const startDate = start.toJSDate()
  // A DTSTART without DTEND or DURATION: a day for a date, no length for a time (RFC 5545 3.6.1).
  let endDate = end.toJSDate()
  if (endDate.getTime() <= startDate.getTime()) {
    endDate = allDay
      ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1)
      : new Date(startDate.getTime())
  }
  const transparency = String(component.getFirstPropertyValue('transp') ?? 'OPAQUE').toUpperCase()
  const location = component.getFirstPropertyValue('location')
  return {
    id: `${calendarId}:${item.uid}:${startDate.toISOString()}`,
    calendarId,
    title: item.summary || '(No title)',
    location: typeof location === 'string' && location ? location : undefined,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    allDay,
    busy: transparency !== 'TRANSPARENT',
    tentative: statusOf(component) === 'TENTATIVE',
  }
}

/** Every occurrence that overlaps [from, to), sorted by start. */
export function occurrencesBetween(feed: ParsedFeed, calendarId: string, from: Date, to: Date): CalendarEvent[] {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const overlaps = (event: CalendarEvent) =>
    new Date(event.start).getTime() < toMs && (new Date(event.end).getTime() > fromMs || event.start === event.end && new Date(event.start).getTime() >= fromMs)
  const out: CalendarEvent[] = []

  for (const event of feed.events) {
    if (!event.isRecurring()) {
      const single = toEvent(calendarId, event, event.startDate, event.endDate)
      if (single && overlaps(single)) out.push(single)
      continue
    }
    const iterator = event.iterator()
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const next = iterator.next()
      if (!next) break
      if (next.toJSDate().getTime() >= toMs) break
      const details = event.getOccurrenceDetails(next)
      const occurrence = toEvent(calendarId, details.item, details.startDate, details.endDate)
      if (occurrence && overlaps(occurrence)) out.push(occurrence)
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}
