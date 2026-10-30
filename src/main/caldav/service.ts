import { createHash } from 'crypto'
import { DAVClient, type DAVCalendarObject } from 'tsdav'
import type { CalDavCalendar, CalDavConnection, CalDavConnectionInput, CalDavEventsResult, CalDavEventUpdate } from '../../shared/caldav-types'
import { connections, removeConnection, saveConnection, secretFor, validateConnection } from './store'
import { expandIcs, rescheduleIcs } from './ics'

export class CalDavError extends Error {}

/** Never forward DAV response bodies/URLs (which can contain secrets) to the renderer or logs. */
export function publicError(error: unknown): string {
  return error instanceof CalDavError ? error.message : 'CalDAV request failed. Check the URL, credentials and server availability.'
}

async function clientFor(connection: CalDavConnectionInput, secret: string): Promise<DAVClient> {
  validateConnection(connection)
  const origin = new URL(connection.url).origin
  const guardedFetch: typeof fetch = async (input, init) => {
    let url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const signal = AbortSignal.timeout(30_000)
    let response: Response
    for (let redirects = 0; ; redirects++) {
      if (url.origin !== origin || url.username || url.password) throw new CalDavError('The server returned a different host. Use that host’s CalDAV URL to connect directly.')
      response = await fetch(url, { ...init, redirect: 'manual', signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects >= 5) throw new CalDavError('CalDAV server redirected too many times.')
      url = new URL(location, url)
    }
    // Digest authentication needs the initial challenge response.
    if (!response.ok && !(connection.authMethod === 'Digest' && response.status === 401)) {
      await response.body?.cancel()
      if (response.status === 401) throw new CalDavError('CalDAV authentication failed. Check your username and password or token.')
      if (response.status === 403) throw new CalDavError('This calendar does not allow that operation.')
      if (response.status === 412) throw new CalDavError('This event changed on the server. Refresh Planner and try again.')
      throw new CalDavError(`CalDAV server returned HTTP ${response.status}.`)
    }
    if (!response.body) return response
    // REPORT responses are untrusted XML; bound decoded bytes, not just Content-Length.
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 20 * 1024 * 1024) {
        await reader.cancel()
        throw new CalDavError('The calendar response is too large (over 20 MB).')
      }
      chunks.push(value)
    }
    const bounded = new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
    Object.defineProperty(bounded, 'url', { value: response.url })
    return bounded
  }
  const client = new DAVClient({
    serverUrl: connection.url,
    authMethod: connection.authMethod === 'None' ? 'Custom' : connection.authMethod,
    authFunction: connection.authMethod === 'None' ? async () => ({}) : undefined,
    credentials: connection.authMethod === 'Bearer' ? { accessToken: secret } : { username: connection.username, password: secret },
    defaultAccountType: 'caldav', fetch: guardedFetch,
  })
  await client.login()
  return client
}

export function calendarColor(value: unknown, url: string): string {
  if (typeof value === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return value.slice(0, 7)
  // Stable distinct fallback when a server supplies no Apple calendar-color property.
  return `#${createHash('sha256').update(url).digest('hex').slice(0, 6)}`
}

export async function discover(input: CalDavConnectionInput): Promise<CalDavConnection> {
  validateConnection(input)
  const secret = input.secret ?? secretFor(input.id)
  const client = await clientFor(input, secret)
  const discovered = await client.fetchCalendars({
    props: {
      'd:displayname': {}, 'd:resourcetype': {}, 'c:supported-calendar-component-set': {},
      'ca:calendar-color': {}, 'd:current-user-privilege-set': {},
    },
    projectedProps: { currentUserPrivilegeSet: true },
  })
  const previous = connections().find((item) => item.id === input.id)
  const calendars = discovered.filter((calendar) => !calendar.components?.length || calendar.components.includes('VEVENT')).map((calendar) => ({
    url: calendar.url,
    name: typeof calendar.displayName === 'string' ? calendar.displayName : 'Calendar',
    color: calendarColor(calendar.calendarColor, calendar.url),
    enabled: previous?.calendars.find((item) => item.url === calendar.url)?.enabled ?? true,
    ...(calendar.projectedProps?.currentUserPrivilegeSet !== undefined ? {
      readOnly: !/"(write|writeContent|all)":/.test(JSON.stringify(calendar.projectedProps.currentUserPrivilegeSet)),
    } : {}),
  }))
  if (!calendars.length) throw new CalDavError('No event calendars were discovered at this URL.')
  const connection: CalDavConnection = {
    id: input.id, name: input.name.trim() || 'CalDAV', url: input.url, username: input.username,
    authMethod: input.authMethod, hasSecret: Boolean(secret), calendars,
  }
  saveConnection(connection, secret)
  clearReferences(input.id)
  return connection
}

export function select(id: string, calendars: CalDavCalendar[]): void {
  const connection = connections().find((item) => item.id === id)
  if (!connection || !Array.isArray(calendars)) throw new CalDavError('Unknown CalDAV connection')
  // Only selection is writable here, never arbitrary calendar/object URLs from a renderer.
  saveConnection({ ...connection, calendars: connection.calendars.map((calendar) => ({
    ...calendar, enabled: calendars.find((item) => item.url === calendar.url)?.enabled === true,
  })) })
  clearReferences(id)
}

interface EventReference {
  connectionId: string
  calendarUrl: string
  object: DAVCalendarObject
  uid: string
  recurrenceId: string
  readOnly: boolean
}
const references = new Map<string, EventReference>()
function clearReferences(id: string) {
  for (const [key, value] of references) if (value.connectionId === id) references.delete(key)
}
export function remove(id: string): void {
  removeConnection(id)
  clearReferences(id)
}

export async function events(start: string, end: string): Promise<CalDavEventsResult> {
  const from = new Date(start)
  const to = new Date(end)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || +to - +from > 7 * 86_400_000) {
    throw new CalDavError('Invalid calendar date range')
  }
  const result: CalDavEventsResult = { events: [], errors: [] }
  for (const connection of connections()) {
    if (!connection.calendars.some((calendar) => calendar.enabled)) continue
    try {
      const client = await clientFor(connection, secretFor(connection.id))
      for (const calendar of connection.calendars.filter((item) => item.enabled)) {
        try {
          const objects = await client.fetchCalendarObjects({ calendar: { url: calendar.url }, timeRange: { start, end } })
          for (const object of objects) {
            try {
              if (typeof object.data !== 'string') continue
              for (const occurrence of expandIcs(object.data, from, to)) {
                const occurrenceKey = createHash('sha256').update(JSON.stringify([
                  connection.id, calendar.url, object.url, occurrence.uid, occurrence.recurrenceId,
                ])).digest('hex')
                const id = createHash('sha256').update(JSON.stringify([occurrenceKey, object.etag])).digest('hex')
                if (references.size >= 10_000) references.delete(references.keys().next().value!)
                references.set(id, { connectionId: connection.id, calendarUrl: calendar.url, object,
                  uid: occurrence.uid, recurrenceId: occurrence.recurrenceId, readOnly: calendar.readOnly === true || occurrence.readOnly || occurrence.allDay || !object.etag })
                result.events.push({ id, occurrenceKey, connectionId: connection.id, calendarUrl: calendar.url, calendarName: calendar.name,
                  color: calendar.color, title: occurrence.title, start: occurrence.start.toISOString(), end: occurrence.end.toISOString(),
                  allDay: occurrence.allDay, readOnly: calendar.readOnly === true || occurrence.readOnly || !object.etag })
              }
            } catch {
              result.errors.push(`${calendar.name}: an event could not be parsed or its recurrence is too large.`)
            }
          }
        } catch (error) { result.errors.push(`${calendar.name}: ${publicError(error)}`) }
      }
    } catch (error) { result.errors.push(`${connection.name}: ${publicError(error)}`) }
  }
  return { events: result.events, errors: [...new Set(result.errors)] }
}

export async function update(input: CalDavEventUpdate): Promise<void> {
  const ref = references.get(input?.id)
  if (!ref) throw new CalDavError('Refresh Planner before editing this event.')
  if (ref.readOnly) throw new CalDavError('This event is read-only.')
  const start = new Date(input.start)
  const end = new Date(input.end)
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start) throw new CalDavError('Invalid event times')
  const connection = connections().find((item) => item.id === ref.connectionId)
  const calendar = connection?.calendars.find((item) => item.url === ref.calendarUrl && item.enabled)
  if (!connection || !calendar) throw new CalDavError('This calendar is no longer enabled.')
  if (calendar.readOnly) throw new CalDavError('This calendar is read-only.')
  const client = await clientFor(connection, secretFor(connection.id))
  // Fetch again, but refuse stale gestures instead of overwriting another client's changes.
  const [fresh] = await client.fetchCalendarObjects({ calendar: { url: calendar.url }, objectUrls: [ref.object.url] })
  if (!fresh || !fresh.etag || fresh.etag !== ref.object.etag || typeof fresh.data !== 'string') {
    throw new CalDavError('This event changed on the server. Refresh Planner and try again.')
  }
  const data = rescheduleIcs(fresh.data, ref.uid, ref.recurrenceId, start, end)
  const response = await client.updateCalendarObject({ calendarObject: { ...fresh, data } })
  if (!response.ok) throw new CalDavError(`Could not save event (HTTP ${response.status}).`)
  // Every occurrence in the resource now has a stale ETag.
  for (const [id, value] of references) if (value.connectionId === ref.connectionId && value.object.url === fresh.url) references.delete(id)
}
