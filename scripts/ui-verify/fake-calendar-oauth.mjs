// A fake Microsoft identity platform + Microsoft Graph and Google OAuth + Calendar API v3, on
// 127.0.0.1, for the calendar account kinds (plan phase 2e). Used by the unit tests
// (src/main/__tests__/calendar-oauth.test.ts) and the harness scenario calendar-accounts (CALA),
// which points the app at it with VICU_TEST_CALENDAR_ENDPOINTS (read only by an unpackaged build).
//
// It checks what a real provider checks: the authorization request (client id, PKCE S256, the
// redirect URI's form, the scopes), the code with its verifier and redirect URI, refresh tokens
// (Microsoft rotates them, Google does not), bearer tokens on every API call, and the client secret
// of Google's Desktop client. Events are placed relative to `base` (local midnight of today by
// default) so a harness run shows them on tomorrow's timeline.

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'

const b64url = (value) => Buffer.from(value).toString('base64url')
const pad = (n) => String(n).padStart(2, '0')

function localAt(base, dayOffset, h = 0, m = 0) {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(h, m, 0, 0)
  return d
}

const day = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
/** Graph's form of a UTC time: "2026-11-10T09:00:00.0000000". */
const graphUtc = (date) => `${date.toISOString().slice(0, 19)}.0000000`

function microsoftEvents(base, prefix) {
  const timed = (id, subject, d, h, m, minutes, extra = {}) => {
    const start = localAt(base, d, h, m)
    const end = new Date(start.getTime() + minutes * 60_000)
    return { id, subject: `${prefix}${subject}`, isAllDay: false, showAs: 'busy', isCancelled: false, responseStatus: { response: 'organizer' }, start: { dateTime: graphUtc(start), timeZone: 'UTC' }, end: { dateTime: graphUtc(end), timeZone: 'UTC' }, location: { displayName: '' }, ...extra }
  }
  const allDay = (id, subject, d, days) => ({
    id,
    subject: `${prefix}${subject}`,
    isAllDay: true,
    showAs: 'free',
    isCancelled: false,
    responseStatus: { response: 'organizer' },
    start: { dateTime: `${day(localAt(base, d))}T00:00:00.0000000`, timeZone: 'UTC' },
    end: { dateTime: `${day(localAt(base, d + days))}T00:00:00.0000000`, timeZone: 'UTC' },
  })
  return {
    work: [
      timed('ms-busy', 'Design review', 1, 10, 0, 60, { location: { displayName: 'Room 4' } }),
      timed('ms-free', 'Lunch (free)', 1, 12, 0, 60, { showAs: 'free' }),
      timed('ms-tentative', 'Maybe sync', 1, 14, 0, 30, { showAs: 'tentative', responseStatus: { response: 'tentativelyAccepted' } }),
      allDay('ms-allday', 'Offsite', 2, 1),
      timed('ms-cancelled', 'Cancelled call', 1, 15, 0, 30, { isCancelled: true }),
      timed('ms-declined', 'Declined meeting', 1, 16, 0, 30, { responseStatus: { response: 'declined' } }),
      timed('ms-retro', 'Retro', 1, 17, 0, 60),
    ],
    home: [timed('ms-home', 'Plumber', 1, 8, 0, 30)],
    holidays: [allDay('ms-holiday', 'Public holiday', 5, 1)],
  }
}

function googleEvents(base, prefix) {
  const timed = (id, summary, d, h, m, minutes, extra = {}) => {
    const start = localAt(base, d, h, m)
    const end = new Date(start.getTime() + minutes * 60_000)
    return { id, status: 'confirmed', summary: `${prefix}${summary}`, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() }, eventType: 'default', ...extra }
  }
  return {
    primary: [
      timed('g-busy', 'Dentist', 1, 9, 0, 45, { location: 'Main St 1' }),
      timed('g-free', 'Focus (free)', 1, 11, 0, 60, { transparency: 'transparent' }),
      timed('g-tentative', 'Coffee maybe', 1, 13, 0, 30, { status: 'tentative' }),
      timed('g-self-tentative', 'Team lunch', 1, 12, 0, 45, { attendees: [{ email: 'a@x', responseStatus: 'accepted' }, { self: true, responseStatus: 'tentative' }] }),
      timed('g-declined', 'Declined planning', 1, 15, 0, 30, { attendees: [{ self: true, responseStatus: 'declined' }] }),
      timed('g-cancelled', 'Cancelled sync', 1, 16, 0, 30, { status: 'cancelled' }),
      { id: 'g-location', status: 'confirmed', summary: 'Home', eventType: 'workingLocation', transparency: 'transparent', start: { date: day(localAt(base, 1)) }, end: { date: day(localAt(base, 2)) } },
      { id: 'g-allday', status: 'confirmed', summary: `${prefix}Holiday`, start: { date: day(localAt(base, 3)) }, end: { date: day(localAt(base, 4)) }, transparency: 'transparent' },
      timed('g-run', 'Evening run', 1, 19, 0, 45),
    ],
    family: [timed('g-family', 'School play', 1, 18, 0, 60)],
    holidays: [],
  }
}

/**
 * Start the fake. `options`: base (Date), prefix (event titles), pageSize (items per page, default
 * 3, so every list is paged). Returns { origin, endpoints, state, close }.
 */
export async function startFakeCalendarProvider(options = {}) {
  const base = options.base ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()
  const prefix = options.prefix ?? ''
  const pageSize = options.pageSize ?? 3
  const state = {
    requests: [],
    /** Set to make the next authorization answer with this error: { error, description }. */
    authorizeError: null,
    /** Answer the redirect with another state (a stale or forged response). */
    wrongState: false,
    /** Answer every refresh with this error: { error, description }. */
    refreshError: null,
    codes: new Map(),
    refreshTokens: new Map(),
    accessTokens: new Set(),
    revoked: [],
    events: { microsoft: microsoftEvents(base, prefix), google: googleEvents(base, prefix) },
    googleSecret: options.googleSecret ?? 'fake-google-secret',
    counter: 0,
  }
  const next = (kind) => `${kind}-${++state.counter}-${randomBytes(4).toString('hex')}`

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const readBody = (req) => new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
  })
  const bearerOk = (req) => {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') && state.accessTokens.has(header.slice(7))
  }
  const idToken = () => `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify({ tid: 'tenant-1', oid: 'user-1', sub: 'sub-1', preferred_username: 'sam@contoso.example', name: 'Sam' }))}.sig`

  function issue(provider, clientId, withRefresh) {
    const access = next('at')
    state.accessTokens.add(access)
    const body = { token_type: 'Bearer', access_token: access, expires_in: 3600 }
    if (withRefresh) {
      const refresh = next('rt')
      state.refreshTokens.set(refresh, { provider, clientId })
      body.refresh_token = refresh
    }
    if (provider === 'microsoft') body.id_token = idToken()
    return body
  }

  function authorize(provider, url, res) {
    const p = url.searchParams
    const redirect = p.get('redirect_uri') ?? ''
    const problems = []
    if (!p.get('client_id')) problems.push('client_id')
    if (p.get('response_type') !== 'code') problems.push('response_type')
    if (p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) problems.push('pkce')
    if (!p.get('state')) problems.push('state')
    const scope = (p.get('scope') ?? '').split(' ')
    if (provider === 'microsoft') {
      if (!/^http:\/\/localhost:\d+\/$/.test(redirect)) problems.push('redirect_uri')
      for (const s of ['Calendars.ReadBasic', 'offline_access']) if (!scope.includes(s)) problems.push(`scope ${s}`)
    } else {
      if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(redirect)) problems.push('redirect_uri')
      if (p.get('access_type') !== 'offline') problems.push('access_type')
      for (const s of ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']) if (!scope.includes(s)) problems.push(`scope ${s}`)
    }
    if (problems.length) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end(`bad authorization request: ${problems.join(', ')}`)
      return
    }
    const target = new URL(redirect)
    target.searchParams.set('state', state.wrongState ? 'not-the-state' : p.get('state'))
    if (state.authorizeError) {
      target.searchParams.set('error', state.authorizeError.error)
      if (state.authorizeError.description) target.searchParams.set('error_description', state.authorizeError.description)
      state.authorizeError = null
    } else {
      const code = next('code')
      state.codes.set(code, { provider, clientId: p.get('client_id'), challenge: p.get('code_challenge'), redirect })
      target.searchParams.set('code', code)
    }
    res.writeHead(302, { Location: target.toString() })
    res.end()
  }

  async function token(provider, req, res) {
    const form = new URLSearchParams(await readBody(req))
    const entry = { method: 'POST', path: `/${provider}/token`, form: Object.fromEntries(form), origin: req.headers.origin ?? null }
    state.requests.push(entry)
    if (provider === 'google' && form.get('client_secret') !== state.googleSecret) return json(res, 401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' })
    if (provider === 'microsoft' && req.headers.origin) return json(res, 400, { error: 'invalid_request', error_description: 'AADSTS9002327: Tokens issued for the Single-Page Application client-type may only be redeemed via cross-origin requests.' })
    const grant = form.get('grant_type')
    if (grant === 'authorization_code') {
      const code = state.codes.get(form.get('code') ?? '')
      state.codes.delete(form.get('code') ?? '')
      if (!code || code.provider !== provider) return json(res, 400, { error: 'invalid_grant', error_description: 'unknown code' })
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url')
      if (challenge !== code.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
      if (form.get('redirect_uri') !== code.redirect) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' })
      if (form.get('client_id') !== code.clientId) return json(res, 400, { error: 'invalid_client' })
      return json(res, 200, issue(provider, code.clientId, true))
    }
    if (grant === 'refresh_token') {
      if (state.refreshError) return json(res, 400, state.refreshError)
      const known = state.refreshTokens.get(form.get('refresh_token') ?? '')
      if (!known || known.provider !== provider) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      // Microsoft rotates (the old one stays valid, as there); Google keeps the refresh token.
      return json(res, 200, issue(provider, known.clientId, provider === 'microsoft'))
    }
    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  function page(items, start) {
    const from = Number(start) || 0
    return { items: items.slice(from, from + pageSize), next: from + pageSize < items.length ? from + pageSize : null }
  }

  function overlaps(event, from, to) {
    const startOf = (t) => (t.date ? new Date(`${t.date}T00:00:00`) : new Date(t.dateTime.endsWith('0000000') ? `${t.dateTime.slice(0, 19)}Z` : t.dateTime))
    const s = startOf(event.start)
    const e = startOf(event.end)
    return s < to && e > from
  }

  function graph(url, req, res) {
    state.requests.push({ method: 'GET', path: url.pathname, prefer: req.headers.prefer ?? null, auth: req.headers.authorization ?? null })
    if (!bearerOk(req)) return json(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token has expired or is not yet valid.' } })
    const path = url.pathname.replace(/^\/graph\/v1\.0/, '')
    if (path === '/me/calendars') {
      const all = [
        { id: 'work', name: `${prefix}Work`, isDefaultCalendar: false },
        { id: 'home', name: `${prefix}Calendar`, isDefaultCalendar: true },
        { id: 'holidays', name: `${prefix}Holidays`, isDefaultCalendar: false },
      ]
      const { items, next: more } = page(all, url.searchParams.get('$skip'))
      const body = { value: items }
      if (more !== null) body['@odata.nextLink'] = `${origin}/graph/v1.0/me/calendars?$skip=${more}`
      return json(res, 200, body)
    }
    const match = /^\/me\/calendars\/([^/]+)\/calendarView$/.exec(path)
    if (match) {
      const events = state.events.microsoft[decodeURIComponent(match[1])]
      if (!events) return json(res, 404, { error: { code: 'ErrorItemNotFound' } })
      const from = new Date(url.searchParams.get('startDateTime'))
      const to = new Date(url.searchParams.get('endDateTime'))
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return json(res, 400, { error: { code: 'ErrorInvalidParameter' } })
      const within = events.filter((event) => overlaps(event, from, to))
      const { items, next: more } = page(within, url.searchParams.get('$skip'))
      const body = { value: items }
      if (more !== null) {
        const nextUrl = new URL(url.toString(), origin)
        nextUrl.searchParams.set('$skip', String(more))
        body['@odata.nextLink'] = `${origin}${nextUrl.pathname}${nextUrl.search}`
      }
      return json(res, 200, body)
    }
    return json(res, 404, { error: { code: 'NotFound' } })
  }

  function google(url, req, res) {
    state.requests.push({ method: 'GET', path: url.pathname, auth: req.headers.authorization ?? null, query: Object.fromEntries(url.searchParams) })
    if (!bearerOk(req)) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } })
    const path = url.pathname.replace(/^\/google\/calendar\/v3/, '')
    if (path === '/users/me/calendarList') {
      const all = [
        { id: 'family-id', summary: `${prefix}Family`, selected: true },
        { id: 'sam@example.com', summary: 'sam@example.com', primary: true, selected: true },
        { id: 'holidays-id', summary: `${prefix}Holidays`, selected: false },
      ]
      const { items, next: more } = page(all, url.searchParams.get('pageToken'))
      return json(res, 200, more !== null ? { items, nextPageToken: String(more) } : { items })
    }
    const match = /^\/calendars\/([^/]+)\/events$/.exec(path)
    if (match) {
      const id = decodeURIComponent(match[1])
      const events = state.events.google[id === 'sam@example.com' ? 'primary' : id === 'family-id' ? 'family' : id === 'holidays-id' ? 'holidays' : '']
      if (!events) return json(res, 404, { error: { code: 404, message: 'Not Found' } })
      if (url.searchParams.get('singleEvents') !== 'true') return json(res, 400, { error: { code: 400, message: 'singleEvents' } })
      const from = new Date(url.searchParams.get('timeMin'))
      const to = new Date(url.searchParams.get('timeMax'))
      const within = events.filter((event) => overlaps(event, from, to))
      const { items, next: more } = page(within, url.searchParams.get('pageToken'))
      return json(res, 200, more !== null ? { items, nextPageToken: String(more) } : { items })
    }
    return json(res, 404, { error: { code: 404 } })
  }

  async function revoke(req, res) {
    const form = new URLSearchParams(await readBody(req))
    state.requests.push({ method: 'POST', path: '/google/revoke', form: Object.fromEntries(form) })
    const tokenValue = form.get('token') ?? ''
    state.revoked.push(tokenValue)
    state.refreshTokens.delete(tokenValue)
    json(res, 200, {})
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    if (req.method === 'GET' && (path === '/microsoft/authorize' || path === '/google/authorize')) {
      state.requests.push({ method: 'GET', path, query: Object.fromEntries(url.searchParams) })
      return authorize(path.startsWith('/microsoft') ? 'microsoft' : 'google', url, res)
    }
    if (req.method === 'POST' && path === '/microsoft/token') return void token('microsoft', req, res)
    if (req.method === 'POST' && path === '/google/token') return void token('google', req, res)
    if (req.method === 'POST' && path === '/google/revoke') return void revoke(req, res)
    if (req.method === 'GET' && path.startsWith('/graph/')) return graph(url, req, res)
    if (req.method === 'GET' && path.startsWith('/google/calendar/v3/')) return google(url, req, res)
    if (req.method !== 'GET') {
      state.requests.push({ method: req.method, path })
      return json(res, 405, { error: 'read-only' })
    }
    json(res, 404, { error: 'not found' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  return {
    origin,
    state,
    /** The value of VICU_TEST_CALENDAR_ENDPOINTS for this fake. */
    endpoints: {
      microsoft: { authorize: `${origin}/microsoft/authorize`, token: `${origin}/microsoft/token`, api: `${origin}/graph/v1.0` },
      google: { authorize: `${origin}/google/authorize`, token: `${origin}/google/token`, revoke: `${origin}/google/revoke`, api: `${origin}/google/calendar/v3` },
    },
    /** Every access token stops working (as when it ends early). */
    expireAccessTokens() {
      state.accessTokens.clear()
    },
    /** Plays the system browser: follows the authorization redirect to Vicu's loopback listener. */
    async browse(authorizeUrl) {
      const first = await fetch(authorizeUrl, { redirect: 'manual' })
      const location = first.headers.get('location')
      if (!location) throw new Error(`authorize answered ${first.status}: ${await first.text()}`)
      // The browser resolves localhost; this one goes to the listener's own address.
      const back = await fetch(location.replace('://localhost:', '://127.0.0.1:'))
      return { status: back.status, location }
    },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}
