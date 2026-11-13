// Reading iCalendar (RFC 5545) data into the occurrences of a time range (contract 20.9).
// ical.js (Mozilla's parser, the one Thunderbird uses) does the parsing, the time zones and the
// recurrence: RRULE, RDATE, EXDATE and RECURRENCE-ID overrides. Every source kind ends here: a
// calendar link is one document, a CalDAV calendar one document per event. Free of Electron so it
// can be tested.
//
// - Zones the file names without defining them (Windows names, IANA names) are built first
//   (timezones.ts), so they are not read as floating local time.
// - VFREEBUSY (what some free/busy shares give) becomes busy periods titled "Busy": FBTYPE=FREE is
//   left out, BUSY-TENTATIVE is tentative.
// - `reduceIcs` is what is kept on disk: only the fields Vicu reads, and with Busy only (20.8) no
//   title or place at all, so the last good copy never holds what the calendar's settings hide.

import ICAL from 'ical.js'
import type { CalendarEvent } from '../../shared/calendar-events'
import { registerMissingZones } from './timezones'

/** A busy period of a VFREEBUSY component. */
export interface FreeBusyPeriod {
  start: Date
  end: Date
  tentative: boolean
}

/** A parsed calendar, kept so a new range does not parse the text again. */
export interface ParsedFeed {
  events: ICAL.Event[]
  busy: FreeBusyPeriod[]
}

/** Occurrences looked at per recurring event at most, so a broken rule cannot hang the main process. */
const MAX_OCCURRENCES = 20_000

/**
 * The work of one read across all repeating events, so many tiny rules cannot add up to a hang: a
 * count of iterator steps, and a time. An ordinary calendar stays far below both (a daily event that
 * started ten years ago takes about 3,650 steps); past either, the remaining repeating events are
 * left out of this read.
 */
export const MAX_TOTAL_STEPS = 2_000_000
export const MAX_EXPAND_MS = 2_000

/** The budget of one read; tests pass a small one. */
export interface ExpandBudget {
  steps: number
  ms: number
}

/** Events taken from one calendar; the rest are left out. */
export const MAX_FEED_EVENTS = 20_000

/** The VCALENDAR components of a text (a file may hold several). */
function rootsOf(text: string): ICAL.Component[] {
  const parsed = ICAL.parse(text) as unknown[]
  if (typeof parsed[0] === 'string') return [new ICAL.Component(parsed as never)]
  return (parsed as unknown[]).map((part) => new ICAL.Component(part as never))
}

function freeBusyOf(component: ICAL.Component): FreeBusyPeriod[] {
  const out: FreeBusyPeriod[] = []
  for (const property of component.getAllProperties('freebusy')) {
    const type = String(property.getParameter('fbtype') ?? 'BUSY').toUpperCase()
    if (type === 'FREE') continue
    for (const value of property.getValues()) {
      if (!(value instanceof ICAL.Period)) continue
      const start = value.start.toJSDate()
      const end = value.getEnd().toJSDate()
      if (end.getTime() > start.getTime()) out.push({ start, end, tentative: type === 'BUSY-TENTATIVE' })
    }
  }
  return out
}

/** Parse the documents of one calendar into its series and busy periods. */
export function parseIcsDocuments(texts: readonly string[]): ParsedFeed {
  const masters = new Map<string, ICAL.Event>()
  const overrides: ICAL.Event[] = []
  const busy: FreeBusyPeriod[] = []
  let count = 0
  for (const text of texts) {
    for (const root of rootsOf(text)) {
      // The file's own VTIMEZONEs first: Outlook names its zones the Windows way ("W. Europe Standard Time").
      const defined = new Set<string>()
      for (const zone of root.getAllSubcomponents('vtimezone')) {
        const timezone = new ICAL.Timezone(zone)
        if (!timezone.tzid) continue
        defined.add(timezone.tzid)
        if (!ICAL.TimezoneService.has(timezone.tzid)) ICAL.TimezoneService.register(timezone)
      }
      registerMissingZones(text, defined)

      // An override (RECURRENCE-ID) belongs to its series; one without a series stands on its own.
      for (const component of root.getAllSubcomponents('vevent')) {
        if (count >= MAX_FEED_EVENTS) break
        count++
        const event = new ICAL.Event(component)
        if (event.isRecurrenceException()) overrides.push(event)
        else masters.set(event.uid, event)
      }
      for (const component of root.getAllSubcomponents('vfreebusy')) busy.push(...freeBusyOf(component))
    }
  }
  const standalone: ICAL.Event[] = []
  for (const override of overrides) {
    const master = masters.get(override.uid)
    if (master) master.relateException(override)
    else standalone.push(override)
  }
  return { events: [...masters.values(), ...standalone], busy }
}

export function parseIcs(text: string): ParsedFeed {
  return parseIcsDocuments([text])
}

/** What a kept event holds: the times, the rule, the state, and (unless Busy only) title and place. */
const EVENT_FIELDS = new Set(['uid', 'dtstart', 'dtend', 'duration', 'rrule', 'rdate', 'exdate', 'recurrence-id', 'status', 'transp', 'summary', 'location'])
const TITLE_FIELDS = new Set(['summary', 'location'])
const FREEBUSY_FIELDS = new Set(['uid', 'dtstart', 'dtend', 'freebusy'])

/**
 * The part of a calendar document Vicu keeps: its zones, and of each event or free/busy block only
 * the fields above. With `busyOnly` the title and place are gone too (20.8), so the copy on disk
 * and in memory cannot hold them. Descriptions, people, alarms and tasks are never kept.
 */
export function reduceIcs(text: string, busyOnly: boolean): string {
  const out = new ICAL.Component('vcalendar')
  out.updatePropertyWithValue('version', '2.0')
  out.updatePropertyWithValue('prodid', '-//Vicu//Calendar copy//EN')
  for (const root of rootsOf(text)) {
    for (const sub of root.getAllSubcomponents()) {
      if (sub.name === 'vtimezone') {
        out.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(sub.toJSON()))))
        continue
      }
      if (sub.name !== 'vevent' && sub.name !== 'vfreebusy') continue
      const fields = sub.name === 'vevent' ? EVENT_FIELDS : FREEBUSY_FIELDS
      const copy = new ICAL.Component(sub.name)
      for (const property of sub.getAllProperties()) {
        if (!fields.has(property.name)) continue
        if (busyOnly && TITLE_FIELDS.has(property.name)) continue
        copy.addProperty(new ICAL.Property(JSON.parse(JSON.stringify(property.toJSON()))))
      }
      out.addSubcomponent(copy)
    }
  }
  return out.toString()
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
    title: (typeof item.summary === 'string' ? item.summary.trim() : '') || '(No title)',
    location: typeof location === 'string' && location.trim() ? location.trim() : undefined,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    allDay,
    busy: transparency !== 'TRANSPARENT',
    tentative: statusOf(component) === 'TENTATIVE',
  }
}

/** Every occurrence that overlaps [from, to), sorted by start; at most `limit` of them. */
export function occurrencesBetween(
  feed: ParsedFeed,
  calendarId: string,
  from: Date,
  to: Date,
  limit = Infinity,
  budget: ExpandBudget = { steps: MAX_TOTAL_STEPS, ms: MAX_EXPAND_MS },
): CalendarEvent[] {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const overlaps = (event: CalendarEvent) =>
    new Date(event.start).getTime() < toMs && (new Date(event.end).getTime() > fromMs || event.start === event.end && new Date(event.start).getTime() >= fromMs)
  const out: CalendarEvent[] = []
  let steps = 0
  const deadline = Date.now() + budget.ms
  let spent = false

  for (const event of feed.events) {
    if (!event.isRecurring()) {
      const single = toEvent(calendarId, event, event.startDate, event.endDate)
      if (single && overlaps(single)) out.push(single)
      continue
    }
    const iterator = event.iterator()
    for (let i = 0; i < MAX_OCCURRENCES && !spent; i++) {
      steps++
      // The clock is read every 256 steps: often enough to stop in time, rare enough to cost nothing.
      if (steps >= budget.steps || ((steps & 255) === 0 && Date.now() > deadline)) spent = true
      const next = iterator.next()
      if (!next) break
      if (next.toJSDate().getTime() >= toMs) break
      const details = event.getOccurrenceDetails(next)
      const occurrence = toEvent(calendarId, details.item, details.startDate, details.endDate)
      if (occurrence && overlaps(occurrence)) out.push(occurrence)
    }
  }
  for (const period of feed.busy) {
    if (period.start.getTime() >= toMs || period.end.getTime() <= fromMs) continue
    const start = period.start.toISOString()
    out.push({
      id: `${calendarId}:freebusy:${start}:${period.end.toISOString()}`,
      calendarId,
      title: 'Busy',
      start,
      end: period.end.toISOString(),
      allDay: false,
      busy: true,
      tentative: period.tentative,
    })
  }
  out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
  return out.length > limit ? out.slice(0, limit) : out
}
