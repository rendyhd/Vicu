// OAuth 2.0 for the Microsoft 365 and Google calendar accounts (docs/calendar-plan.md phase 2e).
// Free of Electron so it can be tested against a fake provider.
//
// - Sign-in: the authorization code flow for native apps (RFC 8252) in the system browser, with
//   PKCE (S256) and a random state, back to a loopback listener on a free port
//   (../auth/loopback-callback.ts). Microsoft ignores the port of `http://localhost`; Google accepts
//   any port on 127.0.0.1 for a Desktop client.
// - Public clients: Microsoft gets no secret; Google's Desktop client has a secret that Google
//   documents as not secret (it ships in every installed app), sent with the token requests.
// - Tokens: the refresh token (and the current access token) live in the connection's sealed config
//   (../store.ts). Microsoft rotates refresh tokens: every refresh can give a new one, which `read`
//   hands back as a changed config, and which is kept in memory here until then.
// - Token and revoke requests are form POSTs, so they do not go through the read-only calendar HTTP:
//   they use `signInFetch` (Node's fetch: Microsoft treats a token request with an Origin header as
//   a single-page app and refuses it).
// - Failures become plain sentences (CalendarReadError). No token, code or secret is ever in one.
// - Tests and the harness point the endpoints at a local fake with VICU_TEST_CALENDAR_ENDPOINTS,
//   read only when the service allowed it (an unpackaged build).

import { randomBytes } from 'crypto'
import { generatePKCE } from '../auth/pkce'
import { listenForCallback, BrowserSignInCancelledError, ProviderRedirectError } from '../auth/loopback-callback'
import {
  CALENDAR_ACCOUNT_PROVIDERS,
  ORG_APPROVAL_MESSAGE,
  SIGN_IN_AGAIN_PREFIX,
  type CalendarAccountProvider,
} from '../../shared/calendar-accounts'
import { CalendarReadError, networkMessage, type FetchLike } from './http'

export interface ProviderEndpoints {
  authorize: string
  token: string
  /** Where a refresh token is revoked; Microsoft has none. */
  revoke?: string
  /** The API's base: https://graph.microsoft.com/v1.0, https://www.googleapis.com/calendar/v3. */
  api: string
}

/** The client a sign-in uses: Vicu's registered one, or the user's own. */
export interface OAuthClient {
  id: string
  /** Google's Desktop client secret (not secret, see above). */
  secret?: string
  /** The user's own client ("Use my own client"). */
  own: boolean
}

export interface TokenSet {
  accessToken: string
  /** Absent when the provider gave none (a refresh that keeps the old one). */
  refreshToken?: string
  /** When the access token ends, ms. */
  expiresAt: number
  idToken?: string
}

const DEFAULT_ENDPOINTS: Record<CalendarAccountProvider, ProviderEndpoints> = {
  microsoft: {
    // The `common` authority: personal (Outlook.com) and work or school accounts.
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    api: 'https://graph.microsoft.com/v1.0',
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    api: 'https://www.googleapis.com/calendar/v3',
  },
}

/** The smallest read-only scopes each provider has for what Vicu reads. */
export const SCOPES: Record<CalendarAccountProvider, string[]> = {
  microsoft: ['Calendars.ReadBasic', 'offline_access', 'openid', 'profile'],
  google: ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
}

const SIGN_IN_TIMEOUT_MS = 5 * 60_000
const TOKEN_TIMEOUT_MS = 20_000
/** An access token this close to its end is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000
const CALLBACK_PATH = '/'

// --- Test endpoints (unpackaged builds only) ------------------------------------------------------

let testOverridesAllowed = false

/** Set by the service: true only in an unpackaged build. */
export function allowTestEndpoints(allowed: boolean): void {
  testOverridesAllowed = allowed
}

interface TestOverride {
  microsoft?: Partial<ProviderEndpoints>
  google?: Partial<ProviderEndpoints>
  /** Pretend this build has official clients. */
  clients?: Partial<Record<CalendarAccountProvider, { clientId: string; clientSecret?: string }>>
}

function testOverride(): TestOverride | null {
  if (!testOverridesAllowed) return null
  const raw = process.env.VICU_TEST_CALENDAR_ENDPOINTS
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as TestOverride
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function providerEndpoints(provider: CalendarAccountProvider): ProviderEndpoints {
  const override = testOverride()?.[provider]
  return override ? { ...DEFAULT_ENDPOINTS[provider], ...override } : DEFAULT_ENDPOINTS[provider]
}

/** The official client a test override pretends this build has, if any. */
export function testOfficialClient(provider: CalendarAccountProvider): { clientId: string; clientSecret?: string } | null {
  const client = testOverride()?.clients?.[provider]
  return client && typeof client.clientId === 'string' && client.clientId ? client : null
}

// --- Errors ---------------------------------------------------------------------------------------

const label = (provider: CalendarAccountProvider) => CALENDAR_ACCOUNT_PROVIDERS[provider].label

/** Microsoft's AADSTS codes that only an administrator (or the tenant's policies) can fix. */
const ORG_CODES = /AADSTS(65001|90094|90095|900941|50105|53000|53003|530003)\b/

/**
 * A provider's OAuth error (from the redirect or the token endpoint) as a plain sentence. The
 * description is read for Microsoft's AADSTS codes but never shown: it can name the tenant.
 */
export function oauthProblem(provider: CalendarAccountProvider, error: string, description = ''): CalendarReadError {
  const code = error.toLowerCase()
  if (provider === 'microsoft' && (ORG_CODES.test(description) || code === 'consent_required' || code === 'interaction_required')) {
    return new CalendarReadError(ORG_APPROVAL_MESSAGE, 'forbidden')
  }
  if (code === 'access_denied') return new CalendarReadError('Vicu was not allowed to read your calendars. Sign in again and allow it.', 'auth')
  if (code === 'invalid_grant') {
    return new CalendarReadError(
      provider === 'google'
        ? `${SIGN_IN_AGAIN_PREFIX} Google no longer accepts Vicu's sign-in. It ends after 7 days while an OAuth client is in testing, or when access was removed.`
        : `${SIGN_IN_AGAIN_PREFIX} Microsoft no longer accepts Vicu's sign-in.`,
      'auth',
    )
  }
  if (/AADSTS7000218\b/.test(description)) {
    return new CalendarReadError('The OAuth client is not a public client. Turn on "Allow public client flows" in its Authentication settings.', 'auth')
  }
  if (code === 'invalid_client' || code === 'unauthorized_client' || /AADSTS700016\b/.test(description)) {
    return new CalendarReadError(`${label(provider)} does not accept this OAuth client. Check the client id${provider === 'google' ? ' and secret' : ''}.`, 'auth')
  }
  if (code === 'redirect_uri_mismatch' || /AADSTS50011\b/.test(description)) {
    return new CalendarReadError(
      provider === 'microsoft'
        ? 'The OAuth client does not allow Vicu\'s sign-in address. Add http://localhost as a redirect URI of the "Mobile and desktop applications" platform.'
        : 'The OAuth client does not allow Vicu\'s sign-in address. Use a client of the type Desktop app.',
      'auth',
    )
  }
  return new CalendarReadError(`${label(provider)} refused the sign-in (${error.replace(/[^\w.-]/g, '').slice(0, 60) || 'error'}).`, 'auth')
}

// --- Token requests -------------------------------------------------------------------------------

function tokenSetOf(json: Record<string, unknown>, now: number): TokenSet {
  const accessToken = typeof json.access_token === 'string' ? json.access_token : ''
  if (!accessToken) throw new CalendarReadError('The sign-in gave no access token.', 'auth')
  const seconds = Number(json.expires_in)
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : undefined,
    expiresAt: now + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
    idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
  }
}

/** A form POST to a token or revoke endpoint; the JSON answer, or the provider's error as a sentence. */
async function formPost(
  provider: CalendarAccountProvider,
  fetch: FetchLike,
  url: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
      redirect: 'error',
    })
  } catch (error) {
    if (controller.signal.aborted) throw new CalendarReadError('The sign-in server took too long to answer.', 'timeout')
    throw networkMessage(error)
  } finally {
    clearTimeout(timer)
  }
  let json: Record<string, unknown> = {}
  try {
    const text = await response.text()
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = {}
  }
  if (!response.ok) {
    if (typeof json.error === 'string') throw oauthProblem(provider, json.error, typeof json.error_description === 'string' ? json.error_description : '')
    if (response.status >= 500) throw new CalendarReadError(`The sign-in server had a problem (${response.status}). Vicu tries again later.`, 'server', response.status)
    throw new CalendarReadError(`The sign-in server answered ${response.status}.`, 'auth', response.status)
  }
  return json
}

function clientForm(client: OAuthClient): Record<string, string> {
  return client.secret ? { client_id: client.id, client_secret: client.secret } : { client_id: client.id }
}

export async function exchangeCode(
  provider: CalendarAccountProvider,
  fetch: FetchLike,
  endpoints: ProviderEndpoints,
  client: OAuthClient,
  code: string,
  verifier: string,
  redirectUri: string,
  now: number,
): Promise<TokenSet> {
  const json = await formPost(provider, fetch, endpoints.token, {
    ...clientForm(client),
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    ...(provider === 'microsoft' ? { scope: SCOPES.microsoft.join(' ') } : {}),
  })
  const tokens = tokenSetOf(json, now)
  if (!tokens.refreshToken) throw new CalendarReadError(`${label(provider)} gave no refresh token, so Vicu could not stay signed in. Try again.`, 'auth')
  return tokens
}

export async function refreshTokens(
  provider: CalendarAccountProvider,
  fetch: FetchLike,
  endpoints: ProviderEndpoints,
  client: OAuthClient,
  refreshToken: string,
  now: number,
): Promise<TokenSet> {
  const json = await formPost(provider, fetch, endpoints.token, {
    ...clientForm(client),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...(provider === 'microsoft' ? { scope: SCOPES.microsoft.join(' ') } : {}),
  })
  return tokenSetOf(json, now)
}

/** Revoke a refresh token where the provider has an endpoint for it (Google); best effort. */
export async function revokeToken(provider: CalendarAccountProvider, fetch: FetchLike, endpoints: ProviderEndpoints, token: string): Promise<void> {
  if (!endpoints.revoke) return
  await formPost(provider, fetch, endpoints.revoke, { token }).catch(() => {})
}

// --- Access tokens of a connection ----------------------------------------------------------------

/** What a connection keeps of its sign-in (inside its sealed config). */
export interface SignedIn {
  provider: CalendarAccountProvider
  client: OAuthClient
  refreshToken: string
  accessToken?: string
  accessExpires?: number
}

/** Refreshes in flight, by refresh token, so the calendars of one account share one. */
const refreshing = new Map<string, Promise<TokenSet>>()
/** A rotated refresh token, by the one it replaced, until the store has the new config. */
const rotated = new Map<string, TokenSet>()

/**
 * A usable access token for `signedIn`, refreshing it when it is (nearly) over or `force`. `changed`
 * holds the new tokens when there was a refresh: the caller writes them into its config.
 */
export async function accessTokenFor(
  signedIn: SignedIn,
  fetch: FetchLike | undefined,
  endpoints: ProviderEndpoints,
  now: number,
  force = false,
): Promise<{ token: string; changed?: { refreshToken: string; accessToken: string; accessExpires: number } }> {
  // A config that holds the rotated token already: what it replaced need not be remembered.
  for (const [old, tokens] of rotated) if (tokens.refreshToken === signedIn.refreshToken) rotated.delete(old)
  const newer = rotated.get(signedIn.refreshToken)
  if (!force && newer && newer.expiresAt - EXPIRY_MARGIN_MS > now) {
    return { token: newer.accessToken, changed: { refreshToken: newer.refreshToken ?? signedIn.refreshToken, accessToken: newer.accessToken, accessExpires: newer.expiresAt } }
  }
  if (!force && signedIn.accessToken && (signedIn.accessExpires ?? 0) - EXPIRY_MARGIN_MS > now) return { token: signedIn.accessToken }
  if (!fetch) throw new CalendarReadError('The calendar could not be read.', 'other')
  const from = newer?.refreshToken ?? signedIn.refreshToken
  let running = refreshing.get(from)
  if (!running) {
    running = refreshTokens(signedIn.provider, fetch, endpoints, signedIn.client, from, now).finally(() => refreshing.delete(from))
    refreshing.set(from, running)
  }
  const tokens = await running
  const refreshToken = tokens.refreshToken ?? from
  const kept: TokenSet = { ...tokens, refreshToken }
  rotated.set(signedIn.refreshToken, kept)
  if (from !== signedIn.refreshToken) rotated.set(from, kept)
  return { token: tokens.accessToken, changed: { refreshToken, accessToken: tokens.accessToken, accessExpires: tokens.expiresAt } }
}

// --- The browser sign-in --------------------------------------------------------------------------

export function authorizeUrl(
  provider: CalendarAccountProvider,
  endpoints: ProviderEndpoints,
  client: OAuthClient,
  redirectUri: string,
  state: string,
  challenge: string,
): string {
  const url = new URL(endpoints.authorize)
  const params = url.searchParams
  params.set('client_id', client.id)
  params.set('response_type', 'code')
  params.set('redirect_uri', redirectUri)
  params.set('scope', SCOPES[provider].join(' '))
  params.set('state', state)
  params.set('code_challenge', challenge)
  params.set('code_challenge_method', 'S256')
  if (provider === 'microsoft') {
    params.set('response_mode', 'query')
    params.set('prompt', 'select_account')
  } else {
    // A refresh token on every sign-in, also when the account allowed Vicu before.
    params.set('access_type', 'offline')
    params.set('prompt', 'consent')
  }
  url.search = params.toString().replace(/\+/g, '%20')
  return url.toString()
}

/** The loopback address the provider redirects to: Microsoft's registered `http://localhost`, any port. */
export function redirectUriFor(provider: CalendarAccountProvider, listening: string): string {
  return provider === 'microsoft' ? listening.replace('://127.0.0.1:', '://localhost:') : listening
}

export interface BrowserSignInOptions {
  provider: CalendarAccountProvider
  client: OAuthClient
  endpoints: ProviderEndpoints
  /** Opens the system browser at the address (Electron's shell.openExternal). */
  open(url: string): Promise<void>
  /** For the token request (ctx.signInFetch). */
  fetch: FetchLike
  now(): number
  signal?: AbortSignal
  timeoutMs?: number
  /** Called once the browser came back, before the code is exchanged (bring the window forward). */
  onReturned?(): void
}

/** Signs in in the system browser and gives the tokens. Throws CalendarReadError, or BrowserSignInCancelledError. */
export async function browserSignIn(options: BrowserSignInOptions): Promise<TokenSet> {
  const { provider } = options
  const state = randomBytes(16).toString('base64url')
  const pkce = generatePKCE()
  let callback
  try {
    callback = await listenForCallback({
      port: 0,
      path: CALLBACK_PATH,
      expectedState: state,
      timeoutMs: options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
      signal: options.signal,
      wording: { errorPrefix: 'Sign-in failed' },
    })
  } catch (error) {
    if (error instanceof BrowserSignInCancelledError) throw error
    throw new CalendarReadError('Vicu could not start the sign-in on this computer.', 'other')
  }
  try {
    const redirectUri = redirectUriFor(provider, callback.redirectUri)
    await options.open(authorizeUrl(provider, options.endpoints, options.client, redirectUri, state, pkce.code_challenge))
    let code: string
    try {
      code = await callback.code
    } catch (error) {
      if (error instanceof BrowserSignInCancelledError) throw error
      if (error instanceof ProviderRedirectError) throw oauthProblem(provider, error.error, error.description)
      throw new CalendarReadError('The sign-in in the browser was not finished in time. Try again.', 'timeout')
    }
    options.onReturned?.()
    return await exchangeCode(provider, options.fetch, options.endpoints, options.client, code, pkce.code_verifier, redirectUri, options.now())
  } finally {
    callback.close()
  }
}

/** The claims of an ID token from the token endpoint (read, not verified: it came straight from the provider over TLS). */
export function idTokenClaims(idToken: string | undefined): Record<string, unknown> {
  if (!idToken) return {}
  const part = idToken.split('.')[1]
  if (!part) return {}
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
