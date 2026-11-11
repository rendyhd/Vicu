// A Microsoft 365 or Outlook.com account (contract 20.9, plan phase 2e), read through Microsoft Graph
// with the delegated permission Calendars.ReadBasic (read-only; no descriptions or attachments).
//
// - Calendars: GET /me/calendars (paged by @odata.nextLink).
// - Events: GET /me/calendars/{id}/calendarView for the window (Graph expands recurrence), in UTC
//   (Prefer: outlook.timezone="UTC"), paged. All-day events are dates in the event's own zone, which
//   Graph gives as midnight: the date part is the day.
// - showAs free or workingElsewhere is not busy (Outlook's scheduling treats both as available),
//   tentative is tentative; cancelled events and those you declined are left out.
// - The account: the ID token's tenant and object id (stable), and its preferred_username.

import type { CalendarHttp } from '../http'
import { idTokenClaims, type ProviderEndpoints } from '../oauth'
import { checkCount, getJson, oauthAccountSource, type AccountEvent, type FoundCalendar } from './oauth-account'

const PAGE = 250
const EVENT_FIELDS = 'id,subject,start,end,isAllDay,showAs,isCancelled,responseStatus,location'

interface GraphTime {
  dateTime?: string
  timeZone?: string
}

interface GraphEvent {
  id?: string
  subject?: string
  start?: GraphTime
  end?: GraphTime
  isAllDay?: boolean
  showAs?: string
  isCancelled?: boolean
  responseStatus?: { response?: string }
  location?: { displayName?: string }
}

/** Graph's "2026-11-10T09:00:00.0000000" in UTC as an ISO instant; null when it is not one. */
function utcInstant(time: GraphTime | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(time?.dateTime ?? '')
  if (!match) return null
  const date = new Date(`${match[1]}Z`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function dayOf(time: GraphTime | undefined): string | null {
  return /^(\d{4}-\d{2}-\d{2})/.exec(time?.dateTime ?? '')?.[1] ?? null
}

/** A Graph event as an occurrence, or null when it is cancelled, declined or has no times. */
export function graphEvent(event: GraphEvent): AccountEvent | null {
  if (!event.id || event.isCancelled === true) return null
  if (String(event.responseStatus?.response ?? '').toLowerCase() === 'declined') return null
  const showAs = String(event.showAs ?? 'busy').toLowerCase()
  const allDay = event.isAllDay === true
  const start = allDay ? dayOf(event.start) : utcInstant(event.start)
  const end = allDay ? dayOf(event.end) : utcInstant(event.end)
  if (!start || !end) return null
  return {
    id: event.id,
    title: event.subject,
    location: event.location?.displayName,
    start,
    // An end before the start reads as one day, or no length (../ics.ts).
    end,
    allDay,
    busy: showAs !== 'free' && showAs !== 'workingelsewhere',
    tentative: showAs === 'tentative',
  }
}

async function pages<T>(http: CalendarHttp, first: string, headers: Record<string, string>, take: (items: T[]) => void): Promise<void> {
  let next: string | undefined = first
  for (let page = 0; next && page < 200; page++) {
    const json = await getJson('microsoft', http, next, headers)
    take(Array.isArray(json.value) ? (json.value as T[]) : [])
    next = typeof json['@odata.nextLink'] === 'string' ? (json['@odata.nextLink'] as string) : undefined
  }
}

export const microsoftSource = oauthAccountSource({
  provider: 'microsoft',

  async listCalendars(http: CalendarHttp, endpoints: ProviderEndpoints): Promise<FoundCalendar[]> {
    const found: FoundCalendar[] = []
    await pages<{ id?: string; name?: string; isDefaultCalendar?: boolean }>(
      http,
      `${endpoints.api}/me/calendars?$select=id,name,isDefaultCalendar&$top=100`,
      {},
      (items) => {
        for (const item of items) {
          if (typeof item.id === 'string' && item.id) found.push({ providerId: item.id, name: String(item.name ?? ''), primary: item.isDefaultCalendar === true })
        }
      },
    )
    return found
  },

  async readEvents(http, endpoints, calendarId, from, to) {
    const out: AccountEvent[] = []
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: EVENT_FIELDS,
      $top: String(PAGE),
    })
    let seen = 0
    await pages<GraphEvent>(
      http,
      `${endpoints.api}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params.toString()}`,
      { Prefer: 'outlook.timezone="UTC"' },
      (items) => {
        seen += items.length
        checkCount(seen)
        for (const item of items) {
          const event = graphEvent(item)
          if (event) out.push(event)
        }
      },
    )
    return out
  },

  identify(tokens) {
    const claims = idTokenClaims(tokens.idToken)
    const text = (name: string) => (typeof claims[name] === 'string' ? (claims[name] as string) : '')
    const id = text('tid') && text('oid') ? `${text('tid')}:${text('oid')}` : text('sub')
    const email = text('preferred_username') || text('email') || text('name') || 'Microsoft account'
    return { id: id || email, email }
  },
})
