import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, safeStorage: {} }))

import { startFakeCalendarProvider, type FakeCalendarProvider } from '../../../scripts/ui-verify/fake-calendar-oauth.mjs'
import { calendarHttp, CalendarReadError, mayCarryBearer, type FetchLike } from '../calendar/http'
import { occurrencesBetween, parseIcsDocuments, reduceIcs } from '../calendar/ics'
import { allowTestEndpoints, browserSignIn, oauthProblem, providerEndpoints, type OAuthClient } from '../calendar/oauth'
import { googleSource } from '../calendar/sources/google'
import { microsoftSource } from '../calendar/sources/microsoft'
import type { OAuthAccountConfig } from '../calendar/sources/oauth-account'
import type { CalendarCopy, SourceContext } from '../calendar/sources/types'
import { accountProblem, checkOwnClient, ORG_APPROVAL_MESSAGE, SIGN_IN_AGAIN_PREFIX } from '../../shared/calendar-accounts'

// The Microsoft 365 and Google account kinds against a local fake provider (the same one the harness
// scenario calendar-accounts uses): the browser sign-in with PKCE and state, token refresh and
// rotation, paging, the mapping of free, tentative, all-day, cancelled and declined events, Busy
// only, and the error sentences. No real provider is ever called.

const MS_CLIENT: OAuthClient = { id: '11111111-2222-3333-4444-555555555555', own: true }
const GOOGLE_CLIENT: OAuthClient = { id: 'fake.apps.googleusercontent.com', secret: 'fake-google-secret', own: true }

let fake: FakeCalendarProvider
let now = Date.now()
const base = new Date()
base.setHours(0, 0, 0, 0)

function context(): SourceContext {
  const fetcher: FetchLike = (url, init) => fetch(url, init)
  return { http: (options) => calendarHttp({ base: fetcher, ...options }), signInFetch: fetcher, now: () => now }
}

async function signIn(provider: 'microsoft' | 'google', client: OAuthClient, timeoutMs = 5000) {
  return browserSignIn({
    provider,
    client,
    endpoints: providerEndpoints(provider),
    open: async (url) => {
      // The "browser" runs in the background, like the real one.
      void fake.browse(url).catch(() => {})
    },
    fetch: (url, init) => fetch(url, init),
    now: () => now,
    timeoutMs,
  })
}

const tomorrow = (h: number, m = 0) => {
  const d = new Date(base)
  d.setDate(d.getDate() + 1)
  d.setHours(h, m, 0, 0)
  return d
}
const range = { from: new Date(base), to: new Date(base.getTime() + 7 * 24 * 3600_000) }

beforeAll(async () => {
  fake = await startFakeCalendarProvider({ base, pageSize: 3 })
  allowTestEndpoints(true)
  process.env.VICU_TEST_CALENDAR_ENDPOINTS = JSON.stringify(fake.endpoints)
})

afterAll(async () => {
  delete process.env.VICU_TEST_CALENDAR_ENDPOINTS
  allowTestEndpoints(false)
  await fake.close()
})

beforeEach(() => {
  now = Date.now()
  fake.state.requests.length = 0
  fake.state.authorizeError = null
  fake.state.wrongState = false
  fake.state.refreshError = null
})

describe('test endpoints', () => {
  it('are read only when allowed', () => {
    allowTestEndpoints(false)
    expect(providerEndpoints('microsoft').token).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token')
    expect(providerEndpoints('google').api).toBe('https://www.googleapis.com/calendar/v3')
    allowTestEndpoints(true)
    expect(providerEndpoints('microsoft').token).toBe(`${fake.origin}/microsoft/token`)
  })
})

describe('a Microsoft 365 account', () => {
  it('signs in in the browser with PKCE and state, then lists every calendar page', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    expect(tokens.refreshToken).toMatch(/^rt-/)
    const authorize = fake.state.requests.find((r) => r.path === '/microsoft/authorize')!
    expect(authorize.query?.code_challenge_method).toBe('S256')
    expect(authorize.query?.scope).toBe('Calendars.ReadBasic offline_access openid profile')
    expect(authorize.query?.redirect_uri).toMatch(/^http:\/\/localhost:\d+\/$/)
    const exchange = fake.state.requests.find((r) => r.path === '/microsoft/token')!
    expect(exchange.form?.grant_type).toBe('authorization_code')
    expect(exchange.form?.code_verifier).toBeTruthy()
    expect(exchange.form?.client_secret).toBeUndefined()
    // No Origin header: Microsoft would take the request for a single-page app's.
    expect(exchange.origin).toBeNull()

    const connected = await microsoftSource.connect({ tokens, client: MS_CLIENT }, context())
    expect(connected.name).toBe('Microsoft 365')
    expect(connected.calendars.map((c) => c.name)).toEqual(['Calendar', 'Work', 'Holidays'])
    expect(connected.config.account).toEqual({ id: 'tenant-1:user-1', email: 'sam@contoso.example' })
    expect(microsoftSource.describe(connected.config)).toBe('sam@contoso.example, your own OAuth client')
    // The remote id is not the provider's id.
    expect(Object.keys(connected.config.calendars)).not.toContain('work')
    // Only GET reached the API.
    expect(fake.state.requests.filter((r) => r.path.startsWith('/graph/')).every((r) => r.method === 'GET')).toBe(true)
  })

  it('ignores a redirect with another state and stops waiting', async () => {
    fake.state.wrongState = true
    await expect(signIn('microsoft', MS_CLIENT, 400)).rejects.toThrow(/not finished in time/)
    expect(fake.state.requests.some((r) => r.path === '/microsoft/token')).toBe(false)
  })

  it('says the organisation must approve Vicu when consent is required', async () => {
    fake.state.authorizeError = { error: 'consent_required', description: 'AADSTS65001: The user or administrator has not consented to use the application.' }
    const error = await signIn('microsoft', MS_CLIENT).catch((e) => e)
    expect(error).toBeInstanceOf(CalendarReadError)
    expect(error.message).toBe(ORG_APPROVAL_MESSAGE)
    expect(accountProblem(error.message)).toBe('org')
    // An admin-only permission, signalled as access_denied with its code.
    expect(oauthProblem('microsoft', 'access_denied', 'AADSTS90094: Admin consent is required.').message).toBe(ORG_APPROVAL_MESSAGE)
  })

  it('maps free, tentative, all-day, cancelled and declined events, over several pages', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    const ctx = context()
    const { config, calendars } = await microsoftSource.connect({ tokens, client: MS_CLIENT }, ctx)
    const work = calendars.find((c) => c.name === 'Work')!.remoteId
    const read = await microsoftSource.read(config, work, range, ctx)
    if (read.status !== 'changed') throw new Error('expected events')
    const view = fake.state.requests.filter((r) => r.path.endsWith('/calendarView'))
    // Seven events, three a page.
    expect(view.length).toBe(3)
    expect(view.every((r) => r.prefer === 'outlook.timezone="UTC"')).toBe(true)

    const events = occurrencesBetween(parseIcsDocuments(read.documents.map((d) => d.ics)), 'w', range.from, range.to)
    const byTitle = Object.fromEntries(events.map((e) => [e.title, e]))
    expect(Object.keys(byTitle).sort()).toEqual(['Design review', 'Lunch (free)', 'Maybe sync', 'Offsite', 'Retro'])
    expect(byTitle['Design review']).toMatchObject({ busy: true, tentative: false, allDay: false, location: 'Room 4', start: tomorrow(10).toISOString(), end: tomorrow(11).toISOString() })
    expect(byTitle['Lunch (free)'].busy).toBe(false)
    expect(byTitle['Maybe sync'].tentative).toBe(true)
    expect(byTitle.Offsite.allDay).toBe(true)
    const offsite = new Date(base)
    offsite.setDate(offsite.getDate() + 2)
    expect(byTitle.Offsite.start).toBe(offsite.toISOString())

    // Busy only: what is kept has no titles or places.
    for (const doc of read.documents) expect(reduceIcs(doc.ics, true)).not.toMatch(/SUMMARY|LOCATION/)
  })

  it('reads nothing new when the events are the same', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    const ctx = context()
    const { config, calendars } = await microsoftSource.connect({ tokens, client: MS_CLIENT }, ctx)
    const id = calendars[1].remoteId
    const first = await microsoftSource.read(config, id, range, ctx)
    if (first.status !== 'changed') throw new Error('expected events')
    const copy: CalendarCopy = { documents: first.documents, validators: first.validators, fetchedAt: now, busyOnly: false }
    expect(microsoftSource.covers(copy, range.from, new Date(range.to.getTime() + 14 * 24 * 3600_000))).toBe(true)
    expect((await microsoftSource.read(config, id, { ...range, previous: copy }, ctx)).status).toBe('unchanged')
  })

  it('refreshes an ended access token and hands back the rotated refresh token', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    const ctx = context()
    const { config, calendars } = await microsoftSource.connect({ tokens, client: MS_CLIENT }, ctx)
    const ended: OAuthAccountConfig = { ...config, accessExpires: now - 1000 }
    fake.state.requests.length = 0
    const read = await microsoftSource.read(ended, calendars[0].remoteId, range, ctx)
    const refresh = fake.state.requests.filter((r) => r.path === '/microsoft/token')
    expect(refresh.map((r) => r.form?.grant_type)).toEqual(['refresh_token'])
    expect(refresh[0].form?.refresh_token).toBe(config.refreshToken)
    expect(refresh[0].form?.scope).toContain('Calendars.ReadBasic')
    expect(read.config).toBeDefined()
    expect(read.config!.refreshToken).not.toBe(config.refreshToken)
    expect(read.config!.accessToken).not.toBe(config.accessToken)

    // With the new config, the next read needs no token request.
    fake.state.requests.length = 0
    await microsoftSource.read(read.config!, calendars[0].remoteId, range, ctx)
    expect(fake.state.requests.some((r) => r.path === '/microsoft/token')).toBe(false)
  })

  it('refreshes once when the API stops taking the access token early', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    const ctx = context()
    const { config, calendars } = await microsoftSource.connect({ tokens, client: MS_CLIENT }, ctx)
    fake.expireAccessTokens()
    fake.state.requests.length = 0
    const read = await microsoftSource.read(config, calendars[0].remoteId, range, ctx)
    expect(read.status).toBe('changed')
    expect(fake.state.requests.filter((r) => r.path === '/microsoft/token').length).toBe(1)
    expect(read.config?.accessToken).toBeTruthy()
  })

  it('says to sign in again, or to ask the organisation, when a refresh is refused', async () => {
    const tokens = await signIn('microsoft', MS_CLIENT)
    const ctx = context()
    const { config, calendars } = await microsoftSource.connect({ tokens, client: MS_CLIENT }, ctx)
    const ended: OAuthAccountConfig = { ...config, accessExpires: 0 }
    fake.state.refreshError = { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity.' }
    const expired = await microsoftSource.read(ended, calendars[0].remoteId, range, ctx).catch((e) => e)
    expect(expired.message.startsWith(SIGN_IN_AGAIN_PREFIX)).toBe(true)
    expect(accountProblem(expired.message)).toBe('sign-in')
    // A token never appears in a message.
    expect(expired.message).not.toContain(config.refreshToken)

    fake.state.refreshError = { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented to use the application.' }
    const consent = await microsoftSource.read({ ...ended, refreshToken: `${config.refreshToken}-x` }, calendars[0].remoteId, range, ctx).catch((e) => e)
    expect(consent.message).toBe(ORG_APPROVAL_MESSAGE)
  })
})

describe('a Google account', () => {
  it('signs in with the Desktop client secret and lists calendars, unticked where Google hides them', async () => {
    const tokens = await signIn('google', GOOGLE_CLIENT)
    const authorize = fake.state.requests.find((r) => r.path === '/google/authorize')!
    expect(authorize.query?.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(authorize.query?.access_type).toBe('offline')
    expect(authorize.query?.scope).toBe('https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly')
    const exchange = fake.state.requests.find((r) => r.path === '/google/token')!
    expect(exchange.form?.client_secret).toBe('fake-google-secret')

    const connected = await googleSource.connect({ tokens, client: GOOGLE_CLIENT }, context())
    expect(connected.name).toBe('Google')
    expect(connected.calendars.map((c) => [c.name, c.suggested !== false])).toEqual([
      ['Calendar', true],
      ['Family', true],
      ['Holidays', false],
    ])
    expect(connected.config.account.email).toBe('sam@example.com')
  })

  it('maps transparency, tentative answers, declines, cancellations and working locations', async () => {
    const tokens = await signIn('google', GOOGLE_CLIENT)
    const ctx = context()
    const { config, calendars } = await googleSource.connect({ tokens, client: GOOGLE_CLIENT }, ctx)
    const read = await googleSource.read(config, calendars[0].remoteId, range, ctx)
    if (read.status !== 'changed') throw new Error('expected events')
    const pages = fake.state.requests.filter((r) => r.path.endsWith('/events'))
    expect(pages.length).toBe(3)
    expect(pages[0].query).toMatchObject({ singleEvents: 'true', orderBy: 'startTime' })
    const events = occurrencesBetween(parseIcsDocuments(read.documents.map((d) => d.ics)), 'g', range.from, range.to)
    const byTitle = Object.fromEntries(events.map((e) => [e.title, e]))
    expect(Object.keys(byTitle).sort()).toEqual(['Coffee maybe', 'Dentist', 'Evening run', 'Focus (free)', 'Holiday', 'Team lunch'])
    expect(byTitle.Dentist).toMatchObject({ busy: true, tentative: false, location: 'Main St 1', start: tomorrow(9).toISOString() })
    expect(byTitle['Focus (free)'].busy).toBe(false)
    expect(byTitle['Coffee maybe'].tentative).toBe(true)
    expect(byTitle['Team lunch'].tentative).toBe(true)
    expect(byTitle.Holiday.allDay).toBe(true)
  })

  it('says to sign in again on invalid_grant (a testing client\'s 7-day tokens)', async () => {
    const tokens = await signIn('google', GOOGLE_CLIENT)
    const ctx = context()
    const { config, calendars } = await googleSource.connect({ tokens, client: GOOGLE_CLIENT }, ctx)
    fake.state.refreshError = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }
    const error = await googleSource.read({ ...config, accessExpires: 0 }, calendars[0].remoteId, range, ctx).catch((e) => e)
    expect(error.message).toMatch(new RegExp(`^${SIGN_IN_AGAIN_PREFIX} Google`))
    expect(error.message).toContain('7 days')
  })

  it('revokes the refresh token when the account is removed', async () => {
    const tokens = await signIn('google', GOOGLE_CLIENT)
    const ctx = context()
    const { config } = await googleSource.connect({ tokens, client: GOOGLE_CLIENT }, ctx)
    await googleSource.disconnect!(config, ctx)
    expect(fake.state.revoked).toContain(config.refreshToken)
  })

  it('refuses a wrong client secret plainly', async () => {
    const error = await signIn('google', { ...GOOGLE_CLIENT, secret: 'wrong' }).catch((e) => e)
    expect(error.message).toBe('Google does not accept this OAuth client. Check the client id and secret.')
  })
})

describe('the rules around the accounts', () => {
  it('sends an access token only to the API origin', () => {
    expect(mayCarryBearer('https://graph.microsoft.com/v1.0/me/calendars', 'https://graph.microsoft.com')).toBe(true)
    expect(mayCarryBearer('https://evil.example/graph', 'https://graph.microsoft.com')).toBe(false)
    expect(mayCarryBearer('http://graph.microsoft.com/v1.0', 'https://graph.microsoft.com')).toBe(false)
    expect(mayCarryBearer('https://graph.microsoft.com.evil.example/', 'https://graph.microsoft.com')).toBe(false)
  })

  it('words the providers\' errors without their descriptions', () => {
    expect(oauthProblem('microsoft', 'invalid_request', 'AADSTS50011: The redirect URI does not match.').message).toContain('http://localhost')
    expect(oauthProblem('microsoft', 'invalid_client', 'AADSTS7000218: client_assertion or client_secret required').message).toContain('public client')
    expect(oauthProblem('google', 'redirect_uri_mismatch').message).toContain('Desktop app')
    expect(oauthProblem('google', 'access_denied').message).toContain('not allowed')
    expect(oauthProblem('microsoft', 'server_error', 'AADSTS50000: tenant secret-tenant.example').message).toBe('Microsoft 365 refused the sign-in (server_error).')
  })

  it('checks an own client', () => {
    expect(checkOwnClient('microsoft', { clientId: ' 11111111-2222-3333-4444-555555555555 ' })).toEqual({ ok: true, value: { clientId: '11111111-2222-3333-4444-555555555555' } })
    expect(checkOwnClient('microsoft', { clientId: 'my-app' }).ok).toBe(false)
    expect(checkOwnClient('google', { clientId: 'x.apps.googleusercontent.com' }).ok).toBe(false)
    expect(checkOwnClient('google', { clientId: 'x.apps.googleusercontent.com', clientSecret: 'GOCSPX-abc' })).toEqual({ ok: true, value: { clientId: 'x.apps.googleusercontent.com', clientSecret: 'GOCSPX-abc' } })
  })
})
