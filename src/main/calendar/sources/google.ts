// A Google account (contract 20.9, plan phase 2e), read through the Calendar API v3 with the scopes
// calendar.calendarlist.readonly and calendar.events.readonly (read-only).
//
// - Calendars: GET /users/me/calendarList (paged by nextPageToken). A calendar unticked in Google
//   (selected false, or hidden) is offered unticked. A calendar named by an address (the primary
//   one is named by the account's) is called "Calendar": calendar names are kept in clear.
// - Events: GET /calendars/{id}/events with singleEvents=true (Google expands recurrence) and
//   orderBy=startTime for the window, paged. Timed events carry an offset; all-day ones are dates.
// - transparency "transparent" is not busy, status "tentative" or your own tentative answer is
//   tentative; cancelled events, those you declined and working-location entries are left out.
// - The account: the primary calendar's id, which is the account's address.

import type { CalendarHttp } from '../http'
import type { ProviderEndpoints } from '../oauth'
import { checkCount, getJson, oauthAccountSource, type AccountEvent, type FoundCalendar } from './oauth-account'

const PAGE = 2500
const LIST_FIELDS = 'items(id,summary,summaryOverride,primary,selected,hidden,deleted),nextPageToken'
const EVENT_FIELDS = 'items(id,status,summary,location,start,end,transparency,eventType,attendees(self,responseStatus)),nextPageToken'

interface GoogleTime {
  date?: string
  dateTime?: string
}

interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  location?: string
  start?: GoogleTime
  end?: GoogleTime
  transparency?: string
  eventType?: string
  attendees?: { self?: boolean; responseStatus?: string }[]
}

function instant(value: string | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** A Google event as an occurrence, or null when it is cancelled, declined or a working location. */
export function googleEvent(event: GoogleEvent): AccountEvent | null {
  if (!event.id || event.status === 'cancelled' || event.eventType === 'workingLocation') return null
  const mine = (event.attendees ?? []).find((attendee) => attendee.self === true)
  if (mine?.responseStatus === 'declined') return null
  const allDay = typeof event.start?.date === 'string'
  const start = allDay ? event.start!.date! : instant(event.start?.dateTime)
  const end = allDay ? (event.end?.date ?? event.start!.date!) : instant(event.end?.dateTime)
  if (!start || !end) return null
  return {
    id: event.id,
    title: event.summary,
    location: event.location,
    start,
    end,
    allDay,
    busy: event.transparency !== 'transparent',
    tentative: event.status === 'tentative' || mine?.responseStatus === 'tentative',
  }
}

async function pages<T>(http: CalendarHttp, url: (pageToken?: string) => string, take: (items: T[]) => void): Promise<void> {
  let token: string | undefined
  for (let page = 0; page < 200; page++) {
    const json = await getJson('google', http, url(token))
    take(Array.isArray(json.items) ? (json.items as T[]) : [])
    token = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : undefined
    if (!token) return
  }
}

export const googleSource = oauthAccountSource({
  provider: 'google',

  async listCalendars(http: CalendarHttp, endpoints: ProviderEndpoints): Promise<FoundCalendar[]> {
    const found: FoundCalendar[] = []
    await pages<{ id?: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean; hidden?: boolean; deleted?: boolean }>(
      http,
      (pageToken) => {
        const params = new URLSearchParams({ maxResults: '250', fields: LIST_FIELDS })
        if (pageToken) params.set('pageToken', pageToken)
        return `${endpoints.api}/users/me/calendarList?${params.toString()}`
      },
      (items) => {
        for (const item of items) {
          if (typeof item.id !== 'string' || !item.id || item.deleted) continue
          // The primary calendar is named by the account's address, which is kept sealed, never as a name in clear.
          const named = String(item.summaryOverride || item.summary || '')
          found.push({
            providerId: item.id,
            name: !named || named === item.id || named.includes('@') ? 'Calendar' : named,
            primary: item.primary === true,
            suggested: item.primary === true || (item.selected === true && item.hidden !== true),
          })
        }
      },
    )
    return found
  },

  async readEvents(http, endpoints, calendarId, from, to) {
    const out: AccountEvent[] = []
    let seen = 0
    await pages<GoogleEvent>(
      http,
      (pageToken) => {
        const params = new URLSearchParams({
          singleEvents: 'true',
          orderBy: 'startTime',
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          maxResults: String(PAGE),
          fields: EVENT_FIELDS,
        })
        if (pageToken) params.set('pageToken', pageToken)
        return `${endpoints.api}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
      },
      (items) => {
        seen += items.length
        checkCount(seen)
        for (const item of items) {
          const event = googleEvent(item)
          if (event) out.push(event)
        }
      },
    )
    return out
  },

  identify(_tokens, calendars) {
    const primary = calendars.find((calendar) => calendar.primary)
    const email = primary?.providerId ?? 'Google account'
    return { id: email, email }
  },
})
