// Classic Outlook on this PC (contract 20.9), Windows only: the calendars of the desktop Outlook,
// read through Outlook's own automation interface by ../outlook.ts and its script, while Outlook is
// open. Nothing goes to a server; the reads stay on the PC.
//
// - One connection holds Outlook's calendars (every account's default calendar and the calendars
//   under it). Its config is the account names for the description; nothing in it is a secret.
// - Outlook expands recurrence itself (IncludeRecurrences), so each occurrence becomes one small
//   iCalendar document, built like the Mac's (eventkit.ts eventToIcs), and goes through ics.ts like
//   every kind: Busy only and the reduced copy are the service's.
// - Show as: Free and Working elsewhere are free, Tentative is tentative, Busy and Away are busy (the
//   same as Microsoft 365). A cancelled meeting is left out, and so is one you declined; one you
//   accepted as tentative or have not answered yet is tentative.
// - A read covers a window around the days asked for (a week before, five weeks after).
// - The new Outlook has no such interface: the add flow says so and points to Microsoft 365.

import { OUTLOOK_CLOSED_MESSAGE, OUTLOOK_MISSING_MESSAGE, type OutlookState } from '../../../shared/calendar-sources'
import { CalendarReadError } from '../http'
import type { HelperEvent } from '../eventkit-helper'
import { eventToIcs, hashOf } from './eventkit'
import type { CalendarCopy, CalendarSource, CopyDocument, RemoteCalendar } from './types'

/** Run the script with a command and its arguments; resolves its JSON answer. */
export type OutlookRunner = (command: 'status' | 'calendars' | 'events', args?: Record<string, string | number>) => Promise<unknown>

export interface OutlookConfig {
  accounts: string[]
}

/** One appointment occurrence as the script gives it. */
export interface OutlookItem {
  key: string
  calendarId?: string
  title?: string
  location?: string
  start: number
  end: number
  allDay?: boolean
  /** OlBusyStatus: 0 free, 1 tentative, 2 busy, 3 out of office, 4 working elsewhere. */
  busy?: number
  /** OlMeetingStatus: 5 and 7 are cancelled. */
  meeting?: number
  /** OlResponseStatus: 2 tentative, 4 declined, 5 not answered yet. */
  response?: number
}

export interface OutlookFolder {
  id: string
  name: string
  account: string
}

const DAY = 24 * 3600_000
const WINDOW_BEFORE = 7 * DAY
const WINDOW_AFTER = 35 * DAY
/** Occurrences a window may hold before a calendar is too large to read. */
export const MAX_OUTLOOK_EVENTS = 5000

const CANCELLED_MEETING = new Set([5, 7])

/** The occurrence in the shape eventToIcs reads (the Mac's), so both kinds build the same documents. */
export function asHelperEvent(item: OutlookItem): HelperEvent {
  const busy = item.busy ?? 2
  const availability = busy === 0 || busy === 4 ? 'free' : busy === 1 ? 'tentative' : busy === 3 ? 'unavailable' : 'busy'
  const self = item.response === 4 ? 'declined' : item.response === 2 ? 'tentative' : item.response === 5 ? 'pending' : undefined
  return {
    key: item.key,
    calendarId: item.calendarId ?? '',
    title: item.title ?? '',
    location: item.location || undefined,
    start: item.start,
    end: item.end,
    allDay: item.allDay === true,
    availability,
    status: item.meeting !== undefined && CANCELLED_MEETING.has(item.meeting) ? 'canceled' : 'confirmed',
    self,
  }
}

/** One occurrence as an iCalendar document; null when it is not shown (cancelled or declined). */
export function outlookItemToIcs(item: OutlookItem): string | null {
  return eventToIcs(asHelperEvent(item), 'Classic Outlook')
}

/** Outlook's calendars as the add flow lists them; names made unique with their account. */
export function outlookCalendars(folders: readonly OutlookFolder[]): RemoteCalendar[] {
  const counts = new Map<string, number>()
  for (const folder of folders) counts.set(folder.name, (counts.get(folder.name) ?? 0) + 1)
  return folders.map((folder) => {
    const name = folder.name.trim() || 'Calendar'
    return { remoteId: folder.id, name: (counts.get(folder.name) ?? 0) > 1 ? `${name} (${folder.account})` : name }
  })
}

function problemOf(answer: unknown): CalendarReadError | null {
  const error = (answer as { error?: unknown } | null)?.error
  if (error === undefined) return null
  if (error === 'missing') return new CalendarReadError(OUTLOOK_MISSING_MESSAGE, 'not-found')
  if (error === 'closed') return new CalendarReadError(OUTLOOK_CLOSED_MESSAGE, 'network')
  return new CalendarReadError('Outlook could not be read. Check that classic Outlook is open and not showing a dialog, then try again.', 'other')
}

/** Outlook on this PC: missing, closed or running (never throws; 'missing' when the script fails). */
export async function outlookState(run: OutlookRunner): Promise<Exclude<OutlookState, 'unsupported'>> {
  try {
    const state = (await run('status') as { state?: unknown } | null)?.state
    return state === 'running' || state === 'closed' ? state : 'missing'
  } catch {
    return 'missing'
  }
}

async function folders(run: OutlookRunner): Promise<OutlookFolder[]> {
  const answer = await run('calendars')
  const problem = problemOf(answer)
  if (problem) throw problem
  const list = (answer as { calendars?: unknown } | null)?.calendars
  return (Array.isArray(list) ? list : []).flatMap((entry) => {
    const folder = entry as Partial<OutlookFolder>
    return typeof folder?.id === 'string' && folder.id ? [{ id: folder.id, name: String(folder.name ?? ''), account: String(folder.account ?? '') }] : []
  })
}

const accountsOf = (list: readonly OutlookFolder[]) => [...new Set(list.map((folder) => folder.account).filter(Boolean))]

export function createOutlookSource(runnerOf: () => OutlookRunner): CalendarSource<OutlookConfig> {
  const source: CalendarSource<OutlookConfig> = {
    kind: 'outlook',

    parseConfig(value) {
      const v = value as Partial<OutlookConfig> | null
      if (!v || typeof v !== 'object') return null
      return { accounts: Array.isArray(v.accounts) ? v.accounts.filter((a): a is string => typeof a === 'string') : [] }
    },

    describe(config) {
      return config.accounts.length ? `Classic Outlook on this PC: ${config.accounts.join(', ')}` : 'Classic Outlook on this PC'
    },

    async connect() {
      const list = await folders(runnerOf())
      if (list.length === 0) throw new CalendarReadError('Classic Outlook has no calendars to show.', 'not-found')
      return { config: { accounts: accountsOf(list) }, name: 'Classic Outlook', calendars: outlookCalendars(list) }
    },

    async listCalendars() {
      const list = await folders(runnerOf())
      return { config: { accounts: accountsOf(list) }, calendars: outlookCalendars(list) }
    },

    covers(copy: CalendarCopy, from: Date, to: Date) {
      const start = copy.validators.from
      const end = copy.validators.to
      return typeof start === 'number' && typeof end === 'number' && start <= from.getTime() && end >= to.getTime()
    },

    async read(_config, remoteId, request) {
      const previous = request.previous
      const sameWindow = previous ? source.covers(previous, request.from, request.to) : false
      const windowFrom = sameWindow ? Number(previous!.validators.from) : request.from.getTime() - WINDOW_BEFORE
      const windowTo = sameWindow ? Number(previous!.validators.to) : request.to.getTime() + WINDOW_AFTER
      const answer = await runnerOf()('events', { Ids: remoteId, From: windowFrom, To: windowTo, Max: MAX_OUTLOOK_EVENTS })
      const problem = problemOf(answer)
      if (problem) throw problem
      const value = (answer ?? {}) as { events?: unknown; missing?: unknown; truncated?: unknown }
      if (Array.isArray(value.missing) && value.missing.includes(remoteId)) throw new CalendarReadError('This calendar is no longer in Outlook.', 'not-found')
      const items = Array.isArray(value.events) ? (value.events as OutlookItem[]) : []
      if (value.truncated === true || items.length > MAX_OUTLOOK_EVENTS) {
        throw new CalendarReadError(`This calendar has more than ${MAX_OUTLOOK_EVENTS} events in these weeks, too many to read.`, 'too-large')
      }
      const documents: CopyDocument[] = []
      for (const item of items) {
        if (typeof item?.key !== 'string' || typeof item.start !== 'number' || typeof item.end !== 'number') continue
        if (item.calendarId && item.calendarId !== remoteId) continue
        const ics = outlookItemToIcs(item)
        if (ics) documents.push({ key: item.key, ics })
      }
      const hash = hashOf(documents)
      const validators = { from: windowFrom, to: windowTo, hash }
      if (previous && sameWindow && previous.validators.hash === hash) return { status: 'unchanged', validators }
      return { status: 'changed', documents, validators }
    },
  }
  return source
}
