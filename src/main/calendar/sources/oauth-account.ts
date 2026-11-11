// What the Microsoft 365 and Google accounts share (contract 20.9, plan phase 2e): the sealed config
// with the sign-in, the access token kept fresh (../oauth.ts), the window read around the days on
// screen, and the provider's events turned into iCalendar documents so they go through the same
// reader, Busy only and last good copy as every other kind (../ics.ts, ../service.ts).
//
// - The provider expands recurrence (Graph's calendarView, Google's singleEvents), so each document
//   is one occurrence with its own UID and UTC times (dates for all-day events).
// - Left out before anything is kept: cancelled events and events the account's owner declined.
//   "Show as free" becomes TRANSP:TRANSPARENT, tentative becomes STATUS:TENTATIVE.
// - A read gives `unchanged` when the window holds the days and the events are the same as last
//   time (a hash of the documents), so nothing is parsed or written then.
// - Read-only: GET requests through ctx.http with the access token, only to the API's origin.

import { createHash } from 'crypto'
import ICAL from 'ical.js'
import { CALENDAR_ACCOUNT_PROVIDERS, SIGN_IN_AGAIN_PREFIX, type CalendarAccountProvider } from '../../../shared/calendar-accounts'
import { CalendarReadError, statusMessage, type CalendarHttp } from '../http'
import { accessTokenFor, providerEndpoints, revokeToken, type OAuthClient, type ProviderEndpoints, type TokenSet } from '../oauth'
import type { CalendarCopy, CalendarSource, CopyDocument, RemoteCalendar, SourceContext } from './types'

export interface OAuthAccountConfig {
  provider: CalendarAccountProvider
  client: OAuthClient
  refreshToken: string
  accessToken?: string
  accessExpires?: number
  /** Who signed in: a stable id (to check a new sign-in is the same account) and the address shown. */
  account: { id: string; email: string }
  /** remoteId → the provider's calendar id. */
  calendars: Record<string, string>
}

/** What `connect` takes: the tokens of a browser sign-in (../oauth.ts browserSignIn) and the client. */
export interface OAuthConnectInput {
  tokens: TokenSet
  client: OAuthClient
}

/** One occurrence as the provider gives it, already mapped. */
export interface AccountEvent {
  /** Unique per occurrence (Graph's occurrence id, Google's instance id). */
  id: string
  title?: string
  location?: string
  /** UTC instants for a timed event; `YYYY-MM-DD` dates (end exclusive) for an all-day one. */
  start: string
  end: string
  allDay: boolean
  busy: boolean
  tentative: boolean
}

export interface FoundCalendar {
  providerId: string
  name: string
  primary?: boolean
  suggested?: boolean
}

/** What a provider adds: its API calls and how it names the account. */
export interface AccountApi {
  provider: CalendarAccountProvider
  listCalendars(http: CalendarHttp, endpoints: ProviderEndpoints): Promise<FoundCalendar[]>
  /** The occurrences of [from, to), already without cancelled and declined ones. */
  readEvents(http: CalendarHttp, endpoints: ProviderEndpoints, calendarId: string, from: Date, to: Date): Promise<AccountEvent[]>
  /** The signed-in account from the tokens and the calendars found. */
  identify(tokens: TokenSet, calendars: FoundCalendar[]): { id: string; email: string }
}

const DAY = 24 * 3600_000
/** The window read around the days asked for, as for CalDAV: a week before, five weeks after. */
const WINDOW_BEFORE = 7 * DAY
const WINDOW_AFTER = 35 * DAY
/** Events a window may hold before a calendar is too large to read. */
export const MAX_ACCOUNT_EVENTS = 5000

export function remoteIdOf(provider: CalendarAccountProvider, calendarId: string): string {
  return createHash('sha256').update(`${provider}:${calendarId}`).digest('hex').slice(0, 16)
}

/** A failed API answer as a plain sentence. */
export function apiProblem(provider: CalendarAccountProvider, status: number, reason = ''): CalendarReadError {
  const name = CALENDAR_ACCOUNT_PROVIDERS[provider].label
  if (status === 401) return new CalendarReadError(`${SIGN_IN_AGAIN_PREFIX} ${name} no longer accepts Vicu's sign-in.`, 'auth', status)
  if (status === 403) {
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) {
      return new CalendarReadError('The Google Calendar API is not turned on in the OAuth client\'s Cloud project.', 'forbidden', status)
    }
    if (/rateLimit|quota/i.test(reason)) return new CalendarReadError(`${name} asks Vicu to wait. It tries again later.`, 'server', status)
    return new CalendarReadError(`${name} refused access to this calendar (403).`, 'forbidden', status)
  }
  if (status === 404 || status === 410) return new CalendarReadError(`The calendar is no longer on the ${name} account.`, 'not-found', status)
  return statusMessage(status, 'account')
}

/** GET a JSON page of the API; a failure as a sentence. */
export async function getJson(provider: CalendarAccountProvider, http: CalendarHttp, url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const response = await http.fetch(url, { headers: { Accept: 'application/json', ...headers } })
  const text = await response.text()
  if (!response.ok) throw apiProblem(provider, response.status, text.slice(0, 2000))
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object') return value as Record<string, unknown>
  } catch {
    // Below.
  }
  throw new CalendarReadError(`${CALENDAR_ACCOUNT_PROVIDERS[provider].label} answered with something that is not a calendar.`, 'format')
}

const utcTime = (iso: string) => ICAL.Time.fromJSDate(new Date(iso), true)
const dateTime = (day: string) => ICAL.Time.fromDateString(day)

/** One occurrence as an iCalendar document, holding only what Vicu reads (../ics.ts reduceIcs keeps the same). */
export function eventDocument(provider: CalendarAccountProvider, event: AccountEvent): CopyDocument {
  const root = new ICAL.Component('vcalendar')
  root.updatePropertyWithValue('version', '2.0')
  root.updatePropertyWithValue('prodid', `-//Vicu//${CALENDAR_ACCOUNT_PROVIDERS[provider].label}//EN`)
  const vevent = new ICAL.Component('vevent')
  vevent.updatePropertyWithValue('uid', `${provider}:${event.id}`)
  vevent.updatePropertyWithValue('dtstart', event.allDay ? dateTime(event.start) : utcTime(event.start))
  vevent.updatePropertyWithValue('dtend', event.allDay ? dateTime(event.end) : utcTime(event.end))
  if (event.title?.trim()) vevent.updatePropertyWithValue('summary', event.title.trim())
  if (event.location?.trim()) vevent.updatePropertyWithValue('location', event.location.trim())
  if (!event.busy) vevent.updatePropertyWithValue('transp', 'TRANSPARENT')
  if (event.tentative) vevent.updatePropertyWithValue('status', 'TENTATIVE')
  root.addSubcomponent(vevent)
  return { key: event.id, ics: root.toString() }
}

function hashOf(documents: CopyDocument[]): string {
  const hash = createHash('sha256')
  for (const doc of documents) hash.update(doc.key).update('\0').update(doc.ics).update('\0')
  return hash.digest('hex')
}

function parseClient(value: unknown): OAuthClient | null {
  const c = value as Partial<OAuthClient> | null
  if (!c || typeof c.id !== 'string' || !c.id) return null
  return { id: c.id, secret: typeof c.secret === 'string' && c.secret ? c.secret : undefined, own: c.own === true }
}

/** A Microsoft or Google account as a calendar source kind. */
export function oauthAccountSource(api: AccountApi): CalendarSource<OAuthAccountConfig> {
  const { provider } = api
  const name = CALENDAR_ACCOUNT_PROVIDERS[provider].label

  /** The API with a fresh access token; `retry` once more with a new one after a 401. */
  async function withToken<T>(config: OAuthAccountConfig, ctx: SourceContext, run: (http: CalendarHttp, endpoints: ProviderEndpoints) => Promise<T>): Promise<{ value: T; config?: OAuthAccountConfig }> {
    const endpoints = providerEndpoints(provider)
    const origin = new URL(endpoints.api).origin
    let current = config
    let changed = false
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await accessTokenFor(current, ctx.signInFetch, endpoints, ctx.now(), attempt > 0)
      if (access.changed) {
        current = { ...current, ...access.changed }
        changed = true
      }
      try {
        const value = await run(ctx.http({ bearer: { token: access.token, origin } }), endpoints)
        return { value, config: changed ? current : undefined }
      } catch (error) {
        // An access token the API stopped taking before its time: one refresh, then say it.
        if (attempt === 0 && error instanceof CalendarReadError && error.status === 401) continue
        throw error
      }
    }
    throw apiProblem(provider, 401)
  }

  function listed(found: FoundCalendar[]): { calendars: Record<string, string>; list: RemoteCalendar[] } {
    const calendars: Record<string, string> = {}
    const list: RemoteCalendar[] = []
    // The primary calendar first, then the provider's order.
    const ordered = [...found.filter((c) => c.primary), ...found.filter((c) => !c.primary)]
    for (const calendar of ordered) {
      const remoteId = remoteIdOf(provider, calendar.providerId)
      if (calendars[remoteId]) continue
      calendars[remoteId] = calendar.providerId
      list.push({ remoteId, name: calendar.name.trim() || 'Calendar', ...(calendar.suggested === false ? { suggested: false } : {}) })
    }
    return { calendars, list }
  }

  const source: CalendarSource<OAuthAccountConfig> = {
    kind: provider,

    parseConfig(value) {
      const v = value as Partial<OAuthAccountConfig> | null
      if (!v || typeof v !== 'object' || v.provider !== provider) return null
      const client = parseClient(v.client)
      if (!client || typeof v.refreshToken !== 'string' || !v.refreshToken) return null
      const account = v.account as Partial<OAuthAccountConfig['account']> | undefined
      if (!account || typeof account.id !== 'string' || typeof account.email !== 'string') return null
      const calendars: Record<string, string> = {}
      for (const [id, calendarId] of Object.entries(v.calendars ?? {})) if (typeof calendarId === 'string') calendars[id] = calendarId
      return {
        provider,
        client,
        refreshToken: v.refreshToken,
        accessToken: typeof v.accessToken === 'string' ? v.accessToken : undefined,
        accessExpires: typeof v.accessExpires === 'number' ? v.accessExpires : undefined,
        account: { id: account.id, email: account.email },
        calendars,
      }
    },

    describe(config) {
      return config.client.own ? `${config.account.email}, your own OAuth client` : config.account.email
    },

    async connect(input, ctx) {
      const value = (input ?? {}) as Partial<OAuthConnectInput>
      if (!value.tokens?.refreshToken || !value.client) throw new CalendarReadError(`Sign in to ${name} first.`, 'auth')
      const base: OAuthAccountConfig = {
        provider,
        client: value.client,
        refreshToken: value.tokens.refreshToken,
        accessToken: value.tokens.accessToken,
        accessExpires: value.tokens.expiresAt,
        account: { id: '', email: '' },
        calendars: {},
      }
      const { value: found, config: refreshed } = await withToken(base, ctx, (http, endpoints) => api.listCalendars(http, endpoints))
      const { calendars, list } = listed(found)
      if (list.length === 0) throw new CalendarReadError('This account has no calendars.', 'not-found')
      const account = api.identify(value.tokens, found)
      return { config: { ...(refreshed ?? base), account, calendars }, name, calendars: list }
    },

    async listCalendars(config, ctx) {
      const { value: found, config: refreshed } = await withToken(config, ctx, (http, endpoints) => api.listCalendars(http, endpoints))
      const { calendars, list } = listed(found)
      return { config: { ...(refreshed ?? config), calendars }, calendars: list }
    },

    covers(copy: CalendarCopy, from: Date, to: Date) {
      const start = copy.validators.from
      const end = copy.validators.to
      return typeof start === 'number' && typeof end === 'number' && start <= from.getTime() && end >= to.getTime()
    },

    async read(config, remoteId, request, ctx) {
      const calendarId = config.calendars[remoteId]
      if (!calendarId) throw new CalendarReadError(`This calendar is no longer on the ${name} account.`, 'not-found')
      const previous = request.previous
      const sameWindow = previous ? source.covers(previous, request.from, request.to) : false
      const windowFrom = sameWindow ? Number(previous!.validators.from) : request.from.getTime() - WINDOW_BEFORE
      const windowTo = sameWindow ? Number(previous!.validators.to) : request.to.getTime() + WINDOW_AFTER
      const { value: events, config: refreshed } = await withToken(config, ctx, (http, endpoints) =>
        api.readEvents(http, endpoints, calendarId, new Date(windowFrom), new Date(windowTo)),
      )
      const documents = events.map((event) => eventDocument(provider, event))
      const hash = hashOf(documents)
      const validators = { from: windowFrom, to: windowTo, hash }
      if (previous && sameWindow && previous.validators.hash === hash) return { status: 'unchanged', validators, config: refreshed }
      return { status: 'changed', documents, validators, config: refreshed }
    },

    async disconnect(config, ctx) {
      if (ctx.signInFetch) await revokeToken(provider, ctx.signInFetch, providerEndpoints(provider), config.refreshToken)
    },
  }
  return source
}

/** Stop paging when a calendar holds more than the limit. */
export function checkCount(count: number): void {
  if (count > MAX_ACCOUNT_EVENTS) {
    throw new CalendarReadError(`This calendar has more than ${MAX_ACCOUNT_EVENTS} events in these weeks, too many to read.`, 'too-large')
  }
}
