// A CalDAV account (contract 20.9): iCloud, Fastmail, Nextcloud, mailbox.org, Radicale, Baikal ...
// tsdav (MIT) does the DAV side, through the service's read-only HTTP; ical.js reads the data.
//
// - Sign in: the server address (a preset's, or typed), a user name and an app password. Discovery
//   goes through /.well-known/caldav, then the principal and its calendar-home-set; only calendars
//   that can hold events (VEVENT) are offered.
// - Read: a calendar-query with a time range for a window around the days on screen, asking only
//   for each event's ETag; then a calendar-multiget for the events that are new or changed since the
//   last good copy. When the window still holds the days and the calendar's ctag (or sync token) is
//   the same as last time, one PROPFIND is all a read costs. Recurrence is expanded by Vicu (ics.ts),
//   never by the server (no <expand>).
// - Read-only: no PUT, DELETE or MKCALENDAR is ever sent (http.ts refuses them).

import { createHash } from 'crypto'
import { calendarMultiGet, calendarQuery, createAccount, fetchCalendars, propfind } from 'tsdav'
import { caldavPreset, caldavServerUrl, type CaldavDiscoverInput, type CaldavPresetId } from '../../../shared/calendar-sources'
import { CalendarReadError, asCalendarError, statusMessage, type BasicAuth, type CalendarHttp } from '../http'
import type { CalendarCopy, CalendarSource, CopyDocument, SourceContext } from './types'

export interface CaldavConfig {
  preset: CaldavPresetId
  serverUrl: string
  username: string
  password: string
  homeUrl: string
  /** remoteId → the calendar's address. */
  calendars: Record<string, string>
}

const DAY = 24 * 3600_000
/** The window read around the days asked for: a week before, five weeks after. */
const WINDOW_BEFORE = 7 * DAY
const WINDOW_AFTER = 35 * DAY
/** Events a window may hold before a calendar is too large to read. */
export const MAX_OBJECTS = 5000
const MULTIGET_CHUNK = 100

export function remoteIdOf(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

function authOf(config: Pick<CaldavConfig, 'username' | 'password' | 'serverUrl'>): BasicAuth {
  return { username: config.username, password: config.password, origin: config.serverUrl }
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  const node = value as { _text?: unknown; _cdata?: unknown } | null | undefined
  if (typeof node?._cdata === 'string') return node._cdata
  if (typeof node?._text === 'string' || typeof node?._text === 'number') return String(node._text)
  return undefined
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The key of an object address, the same whether a server answers with a path or a full URL. */
function hrefKey(href: string, base: string): string {
  try {
    return decodeURIComponent(new URL(href, base).pathname)
  } catch {
    return href
  }
}

const icalTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`

function timeRangeFilter(from: number, to: number) {
  return [
    {
      'comp-filter': {
        _attributes: { name: 'VCALENDAR' },
        'comp-filter': {
          _attributes: { name: 'VEVENT' },
          'time-range': { _attributes: { start: icalTime(from), end: icalTime(to) } },
        },
      },
    },
  ]
}

async function findCalendars(config: Omit<CaldavConfig, 'calendars'>, http: CalendarHttp) {
  // The calendars' addresses are paths on the home's host, which may not be the one typed
  // (iCloud answers from p52-caldav.icloud.com).
  const rootUrl = `${new URL(config.homeUrl).origin}/`
  const found = await fetchCalendars({
    account: { accountType: 'caldav', serverUrl: config.serverUrl, rootUrl, homeUrl: config.homeUrl },
    fetch: http.fetch as typeof fetch,
  })
  const calendars: Record<string, string> = {}
  const list: { remoteId: string; name: string }[] = []
  for (const calendar of found) {
    const components = (calendar.components ?? []).map((name) => String(name).toUpperCase())
    if (components.length > 0 && !components.includes('VEVENT')) continue
    const remoteId = remoteIdOf(calendar.url)
    if (calendars[remoteId]) continue
    calendars[remoteId] = calendar.url
    const named = textOf(calendar.displayName)?.trim()
    const fallback = decodeURIComponent(new URL(calendar.url).pathname.split('/').filter(Boolean).pop() ?? 'Calendar')
    list.push({ remoteId, name: named || fallback })
  }
  return { calendars, list }
}

export const caldavSource: CalendarSource<CaldavConfig> = {
  kind: 'caldav',

  parseConfig(value) {
    const v = value as Partial<CaldavConfig> | null
    if (!v || typeof v !== 'object') return null
    if (typeof v.serverUrl !== 'string' || typeof v.username !== 'string' || typeof v.password !== 'string' || typeof v.homeUrl !== 'string') return null
    const calendars: Record<string, string> = {}
    for (const [id, url] of Object.entries(v.calendars ?? {})) if (typeof url === 'string') calendars[id] = url
    return { preset: caldavPreset(String(v.preset)).id, serverUrl: v.serverUrl, username: v.username, password: v.password, homeUrl: v.homeUrl, calendars }
  },

  describe(config) {
    return `${config.username} on ${hostOf(config.serverUrl)}`
  },

  async connect(input, ctx) {
    const value = (input ?? {}) as Partial<CaldavDiscoverInput>
    const preset = caldavPreset(String(value.preset ?? 'other'))
    const serverUrl = caldavServerUrl(preset.id, value.server)
    if (!serverUrl) throw new CalendarReadError('Enter the server address, such as https://cloud.example.com.', 'format')
    const username = String(value.username ?? '').trim()
    const password = String(value.password ?? '')
    if (!username || !password) throw new CalendarReadError('Enter the user name and the app password.', 'format')
    const auth: BasicAuth = { username, password, origin: serverUrl }
    const http = ctx.http({ auth })
    try {
      const account = await createAccount({ account: { accountType: 'caldav', serverUrl }, fetch: http.fetch as typeof fetch })
      if (!account.homeUrl) throw new CalendarReadError('No calendars were found on this account.', 'not-found')
      const base = { preset: preset.id, serverUrl, username, password, homeUrl: account.homeUrl }
      const { calendars, list } = await findCalendars(base, http)
      if (list.length === 0) throw new CalendarReadError('This account has no calendars with events.', 'not-found')
      const config: CaldavConfig = { preset: preset.id, serverUrl, username, password, homeUrl: account.homeUrl, calendars }
      // The name is kept in clear, so it never holds the server's address (that is in the sealed config).
      return { config, name: preset.id === 'other' ? 'CalDAV' : preset.label, calendars: list }
    } catch (error) {
      throw asCalendarError(error, http, 'account')
    }
  },

  async listCalendars(config, ctx) {
    const http = ctx.http({ auth: authOf(config) })
    try {
      const { calendars, list } = await findCalendars(config, http)
      return { config: { ...config, calendars }, calendars: list }
    } catch (error) {
      throw asCalendarError(error, http, 'account')
    }
  },

  covers(copy: CalendarCopy, from: Date, to: Date) {
    const start = copy.validators.from
    const end = copy.validators.to
    return typeof start === 'number' && typeof end === 'number' && start <= from.getTime() && end >= to.getTime()
  },

  async read(config, remoteId, request, ctx) {
    const url = config.calendars[remoteId]
    if (!url) throw new CalendarReadError('This calendar is no longer on the account.', 'not-found')
    const http = ctx.http({ auth: authOf(config) })
    const fetch = http.fetch as typeof globalThis.fetch
    const previous = request.previous
    const sameWindow = previous ? caldavSource.covers(previous, request.from, request.to) : false
    const windowFrom = sameWindow ? Number(previous!.validators.from) : request.from.getTime() - WINDOW_BEFORE
    const windowTo = sameWindow ? Number(previous!.validators.to) : request.to.getTime() + WINDOW_AFTER
    try {
      // The calendar's version: unchanged and the same window, nothing else to read.
      const [state] = await propfind({ url, props: { 'cs:getctag': {}, 'd:sync-token': {} }, depth: '0', fetch })
      if (state && !state.ok && state.status) throw statusMessage(state.status, 'account')
      const ctag = textOf(state?.props?.getctag) ?? ''
      const syncToken = textOf(state?.props?.syncToken) ?? ''
      const validators = { from: windowFrom, to: windowTo, ctag, syncToken }
      if (previous && sameWindow && ((ctag && ctag === previous.validators.ctag) || (syncToken && syncToken === previous.validators.syncToken))) {
        return { status: 'unchanged', validators }
      }

      const listing = await calendarQuery({ url, props: { 'd:getetag': {} }, filters: timeRangeFilter(windowFrom, windowTo), depth: '1', fetch })
      const objects = listing
        .filter((entry) => typeof entry.href === 'string' && entry.href && (entry.ok !== false))
        .map((entry) => ({ href: entry.href as string, key: hrefKey(entry.href as string, url), etag: textOf(entry.props?.getetag) }))
        .filter((entry) => entry.key !== hrefKey(url, url))
      if (objects.length > MAX_OBJECTS) {
        throw new CalendarReadError(`This calendar has more than ${MAX_OBJECTS} events in these weeks, too many to read.`, 'too-large')
      }

      const before = new Map((previous?.documents ?? []).map((doc) => [doc.key, doc]))
      const needed = objects.filter((entry) => {
        const known = before.get(entry.key)
        return !known || !entry.etag || known.etag !== entry.etag
      })
      const fetched = new Map<string, CopyDocument>()
      for (let i = 0; i < needed.length; i += MULTIGET_CHUNK) {
        const chunk = needed.slice(i, i + MULTIGET_CHUNK)
        const answers = await calendarMultiGet({
          url,
          props: { 'd:getetag': {}, 'c:calendar-data': {} },
          objectUrls: chunk.map((entry) => entry.href),
          depth: '1',
          fetch,
        })
        for (const answer of answers) {
          if (!answer.href || answer.ok === false) continue
          const ics = textOf(answer.props?.calendarData)
          if (!ics) continue
          const key = hrefKey(answer.href, url)
          fetched.set(key, { key, etag: textOf(answer.props?.getetag), ics })
        }
      }

      const documents: CopyDocument[] = []
      for (const entry of objects) {
        const doc = fetched.get(entry.key) ?? before.get(entry.key)
        if (doc) documents.push(doc)
      }
      const unchanged = previous && sameWindow && fetched.size === 0 && documents.length === previous.documents.length
      return unchanged ? { status: 'unchanged', validators } : { status: 'changed', documents, validators }
    } catch (error) {
      throw asCalendarError(error, http, 'account')
    }
  },
}
