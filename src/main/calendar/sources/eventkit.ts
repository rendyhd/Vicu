// The calendars of this Mac through EventKit (contract 20.9, docs/calendar-plan.md 2d): whatever
// the Mac has in System Settings, Internet Accounts (iCloud, Google, Exchange, CalDAV), without a
// sign-in in Vicu. macOS only; the reads go through the calendar helper (../eventkit-helper.ts,
// native/calendar-macos/), which asks macOS for the permission and never writes.
//
// - One connection holds the Mac's calendars; nothing in its config is a secret (the calendar ids
//   and the account names), the store seals it like any other.
// - EventKit expands recurrence itself, so each occurrence becomes one small iCalendar document
//   (UID = the occurrence's key, no RRULE) and goes through ics.ts like every kind: Busy only and
//   the reduced copy are the service's, the same as for a link or a CalDAV account.
// - Cancelled events and those the user declined are left out (the helper does it, and so does
//   this file). Free is TRANSP:TRANSPARENT; tentative (the event's availability or status, or the
//   user's own answer tentative or not given yet) is STATUS:TENTATIVE.
// - A read covers a window around the days asked for (a week before, five weeks after), like
//   CalDAV; reads are local and cheap, so the service also reads again at once when the helper
//   says the Mac's calendars changed.

import { createHash } from 'crypto'
import type { EventKitFoundCalendar } from '../../../shared/calendar-eventkit'
import { EVENTKIT_DENIED_MESSAGE } from '../../../shared/calendar-eventkit'
import { CalendarReadError } from '../http'
import type { EventKitHelper, HelperCalendar, HelperEvent } from '../eventkit-helper'
import type { CalendarCopy, CalendarSource, CopyDocument, RemoteCalendar } from './types'

export interface EventKitConfig {
  /** The accounts the calendars came from, for the description. */
  accounts: string[]
}

const DAY = 24 * 3600_000
const WINDOW_BEFORE = 7 * DAY
const WINDOW_AFTER = 35 * DAY
/** Occurrences a window may hold before a calendar is too large to read. */
export const MAX_EVENTS = 5000

const accountOf = (calendar: HelperCalendar) => calendar.source?.trim() || 'This Mac'

/** The Mac's calendars as the add flow lists them; names made unique with their account. */
export function foundCalendars(calendars: readonly HelperCalendar[]): EventKitFoundCalendar[] {
  const titles = new Map<string, number>()
  for (const calendar of calendars) titles.set(calendar.title, (titles.get(calendar.title) ?? 0) + 1)
  return calendars.map((calendar) => {
    const title = calendar.title.trim() || 'Calendar'
    const name = (titles.get(calendar.title) ?? 0) > 1 ? `${title} (${accountOf(calendar)})` : title
    return { remoteId: calendar.id, name, account: accountOf(calendar), color: calendar.color, suggested: calendar.type !== 'birthday' }
  })
}

function accountsOf(calendars: readonly HelperCalendar[]): string[] {
  return [...new Set(calendars.map(accountOf))]
}

// --- One occurrence as iCalendar ---------------------------------------------------------------------

function escapeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const utcStamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z'
const localDate = (date: Date) => `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`

/** Whether an occurrence is shown at all: not cancelled, not declined by the user. */
export function isShown(event: HelperEvent): boolean {
  return event.status !== 'canceled' && event.self !== 'declined'
}

export function isTentative(event: HelperEvent): boolean {
  return event.availability === 'tentative' || event.status === 'tentative' || event.self === 'tentative' || event.self === 'pending'
}

/**
 * One occurrence as an iCalendar document; null when it is not shown. An all-day event's days are
 * this Mac's local dates (EventKit gives local midnights): its end is the day after its last day.
 */
export function eventToIcs(event: HelperEvent): string | null {
  if (!isShown(event)) return null
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vicu//Mac calendars//EN', 'BEGIN:VEVENT', `UID:${escapeText(event.key)}`]
  if (event.allDay) {
    const first = new Date(event.start)
    const firstDay = new Date(first.getFullYear(), first.getMonth(), first.getDate())
    // EventKit ends an all-day event at 23:59:59 of its last day (some accounts at the next midnight).
    const last = new Date(Math.max(event.end - 1, event.start))
    let after = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
    if (after.getTime() <= firstDay.getTime()) after = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + 1)
    lines.push(`DTSTART;VALUE=DATE:${localDate(firstDay)}`, `DTEND;VALUE=DATE:${localDate(after)}`)
  } else {
    lines.push(`DTSTART:${utcStamp(event.start)}`, `DTEND:${utcStamp(Math.max(event.end, event.start))}`)
  }
  if (event.title) lines.push(`SUMMARY:${escapeText(event.title)}`)
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
  if (event.availability === 'free') lines.push('TRANSP:TRANSPARENT')
  if (isTentative(event)) lines.push('STATUS:TENTATIVE')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

function hashOf(documents: readonly CopyDocument[]): string {
  const hash = createHash('sha256')
  for (const doc of documents) hash.update(doc.key).update('\0').update(doc.ics).update('\0')
  return hash.digest('hex')
}

/** Throw the sentence for a Mac that has not let Vicu read its calendars. */
async function requireAccess(helper: EventKitHelper): Promise<void> {
  const access = await helper.status()
  if (access === 'full') return
  if (access === 'not-determined') throw new CalendarReadError('Vicu has not been allowed to read the calendars of this Mac yet. Add them again to be asked.', 'forbidden')
  throw new CalendarReadError(EVENTKIT_DENIED_MESSAGE, 'forbidden')
}

/**
 * The kind, over a helper. `helperOf` throws a CalendarReadError when there is none (not a Mac, or
 * a build without the helper), so the add flow and every read say so plainly.
 */
export function createEventKitSource(helperOf: () => EventKitHelper): CalendarSource<EventKitConfig> {
  const source: CalendarSource<EventKitConfig> = {
    kind: 'eventkit',

    parseConfig(value) {
      const v = value as Partial<EventKitConfig> | null
      if (!v || typeof v !== 'object') return null
      return { accounts: Array.isArray(v.accounts) ? v.accounts.filter((a): a is string => typeof a === 'string') : [] }
    },

    describe(config) {
      return config.accounts.length ? `On this Mac: ${config.accounts.join(', ')}` : 'On this Mac'
    },

    async connect() {
      const helper = helperOf()
      await requireAccess(helper)
      const calendars = await helper.calendars()
      if (calendars.length === 0) throw new CalendarReadError('This Mac has no calendars with events. Add an account in System Settings, Internet Accounts.', 'not-found')
      const list: RemoteCalendar[] = foundCalendars(calendars).map(({ remoteId, name }) => ({ remoteId, name }))
      return { config: { accounts: accountsOf(calendars) }, name: 'Mac calendars', calendars: list }
    },

    async listCalendars() {
      const helper = helperOf()
      await requireAccess(helper)
      const calendars = await helper.calendars()
      return { config: { accounts: accountsOf(calendars) }, calendars: foundCalendars(calendars).map(({ remoteId, name }) => ({ remoteId, name })) }
    },

    covers(copy: CalendarCopy, from: Date, to: Date) {
      const start = copy.validators.from
      const end = copy.validators.to
      return typeof start === 'number' && typeof end === 'number' && start <= from.getTime() && end >= to.getTime()
    },

    async read(_config, remoteId, request) {
      const helper = helperOf()
      const previous = request.previous
      const sameWindow = previous ? source.covers(previous, request.from, request.to) : false
      const windowFrom = sameWindow ? Number(previous!.validators.from) : request.from.getTime() - WINDOW_BEFORE
      const windowTo = sameWindow ? Number(previous!.validators.to) : request.to.getTime() + WINDOW_AFTER
      const answer = await helper.events([remoteId], windowFrom, windowTo)
      if (answer.missing.includes(remoteId)) throw new CalendarReadError('This calendar is no longer on this Mac.', 'not-found')
      if (answer.truncated || answer.events.length > MAX_EVENTS) {
        throw new CalendarReadError(`This calendar has more than ${MAX_EVENTS} events in these weeks, too many to read.`, 'too-large')
      }
      const documents: CopyDocument[] = []
      for (const event of answer.events) {
        if (event.calendarId && event.calendarId !== remoteId) continue
        const ics = eventToIcs(event)
        if (ics) documents.push({ key: event.key, ics })
      }
      const hash = hashOf(documents)
      const validators = { from: windowFrom, to: windowTo, hash }
      if (previous && sameWindow && previous.validators.hash === hash) return { status: 'unchanged', validators }
      return { status: 'changed', documents, validators }
    },
  }
  return source
}
