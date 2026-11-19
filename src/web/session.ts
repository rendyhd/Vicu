import { isNotApiErrorAnswer } from '../shared/error-classify'
import { isTotpChallenge, parseVikunjaProblem } from '../main/auth/totp'
import { buildAuthorizationUrl, interpretRedirect } from '../main/auth/oidc-url'
import type { OIDCProvider } from '../main/auth/oidc-discovery'

// The web version's sign-in (password and OIDC). Vikunja 2 keeps a session in two parts: a JWT that
// lives about ten minutes, and a refresh token it sets as an HttpOnly cookie on
// /api/v1/user/token/refresh. The browser keeps that cookie itself, so nothing this code can read
// is worth stealing for long: the JWT stays in memory only and is never written to storage.
//
// The app and the API share one origin (the container's proxy), so every address here is relative
// to the page.

const SESSION_CHANNEL = 'vicu-web-session'
const SESSION_LOCK = 'vicu-web-session'
const PENDING_OIDC_KEY = 'vicu-web-oidc'
/** Renew this long before the JWT ends. */
const RENEW_AHEAD_S = 60
/** A JWT this close to its end is not handed out any more. */
const EXPIRY_SKEW_S = 20
/** Sent when the server cannot be reached and there is no JWT: the request fails on the same outage. */
const NO_TOKEN = 'unreachable'
const REQUEST_TIMEOUT_MS = 15_000

let jwt: string | null = null
let expiresAt = 0
let renewTimer: ReturnType<typeof setTimeout> | null = null
let renewing: Promise<RenewOutcome> | null = null
let channel: BroadcastChannel | null = null
const endedListeners = new Set<() => void>()

export type RenewOutcome = 'renewed' | 'ended' | 'unreachable'

const origin = (): string => window.location.origin
const nowSeconds = (): number => Date.now() / 1000

/** The `exp` of a JWT (seconds since the epoch), or null. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null
  } catch {
    return null
  }
}

function scheduleRenewal(): void {
  if (renewTimer) clearTimeout(renewTimer)
  renewTimer = null
  if (!jwt) return
  const inMs = Math.max(5_000, (expiresAt - RENEW_AHEAD_S - nowSeconds()) * 1000)
  renewTimer = setTimeout(() => {
    // A hidden tab renews when it is looked at again (or when it next sends a request).
    if (document.visibilityState === 'visible') void renewSession()
  }, inMs)
}

function setJwt(token: string, tellOtherTabs: boolean): void {
  jwt = token
  expiresAt = jwtExpiry(token) ?? nowSeconds() + 600
  scheduleRenewal()
  if (tellOtherTabs) channel?.postMessage({ jwt: token })
}

/** Forget the session in this tab (and in the others when asked). */
export function clearSession(tellOtherTabs: boolean): void {
  jwt = null
  expiresAt = 0
  if (renewTimer) clearTimeout(renewTimer)
  renewTimer = null
  if (tellOtherTabs) channel?.postMessage({ signedOut: true })
}

/** Start listening to the other tabs and to the tab becoming visible again. */
export function initSession(): void {
  if (typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(SESSION_CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { jwt?: unknown; signedOut?: unknown } | null
      if (typeof data?.jwt === 'string') setJwt(data.jwt, false)
      else if (data?.signedOut === true) {
        clearSession(false)
        for (const listener of [...endedListeners]) listener()
      }
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && jwt && nowSeconds() > expiresAt - RENEW_AHEAD_S) void renewSession()
  })
}

/** Another tab signed out. */
export function onSignedOutElsewhere(listener: () => void): () => void {
  endedListeners.add(listener)
  return () => {
    endedListeners.delete(listener)
  }
}

/** The JWT when one is at hand and still good, without waiting. */
export function sessionTokenSync(): string | null {
  return jwt && nowSeconds() < expiresAt - EXPIRY_SKEW_S ? jwt : null
}

function withLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(name, run) as Promise<T> : run()
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store', credentials: 'same-origin' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Renew the JWT with the session cookie. One renewal at a time across tabs: the refresh token
 * rotates, and a tab that waited for the lock usually finds the JWT the other tab just got.
 */
export function renewSession(): Promise<RenewOutcome> {
  if (!renewing) {
    renewing = withLock(SESSION_LOCK, async (): Promise<RenewOutcome> => {
      if (sessionTokenSync() && nowSeconds() < expiresAt - RENEW_AHEAD_S) return 'renewed'
      try {
        const response = await timedFetch(`${origin()}/api/v1/user/token/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const text = await response.text().catch(() => '')
        if (response.ok) {
          let token: unknown
          try {
            token = (JSON.parse(text) as { token?: unknown }).token
          } catch {
            token = undefined
          }
          if (typeof token === 'string' && token) {
            setJwt(token, true)
            return 'renewed'
          }
          // A 2xx that is not the API (a sign-in page in front of the server).
          return 'unreachable'
        }
        // A sign-in page or a firewall answering is not the server ending the session.
        if (isNotApiErrorAnswer(response.status, text)) return 'unreachable'
        if (response.status >= 500 || response.status === 429 || response.status === 408) return 'unreachable'
        return 'ended'
      } catch {
        return 'unreachable'
      }
    }).finally(() => {
      renewing = null
    })
  }
  return renewing
}

/**
 * The JWT to send, renewed when needed. Rejects only when the server said the session has ended.
 * When the server cannot be reached the old JWT (or a stand-in) is returned: the request it is
 * for fails on the same outage, which reads as "not connected" and not as "sign in again".
 */
export async function sessionToken(): Promise<string> {
  const current = sessionTokenSync()
  if (current) return current
  const outcome = await renewSession()
  if (outcome === 'renewed' && jwt) return jwt
  if (outcome === 'unreachable') return jwt ?? NO_TOKEN
  clearSession(false)
  throw new Error('Session expired')
}

export type PasswordLoginResult =
  | { success: true; token: string }
  | { success: false; error: string; totpRequired?: boolean }

/** Sign in with a username and password (and a TOTP code when asked for one). */
export async function loginWithPassword(username: string, password: string, totpPasscode?: string): Promise<PasswordLoginResult> {
  try {
    const response = await timedFetch(`${origin()}/api/v2/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, long_token: true, ...(totpPasscode ? { totp_passcode: totpPasscode } : {}) }),
    })
    if (response.status === 403) return { success: false, error: 'Invalid username or password' }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const { errorCode, message } = parseVikunjaProblem(text, response.status)
      if (isTotpChallenge(response.status, errorCode)) return { success: false, error: message, totpRequired: true }
      return { success: false, error: message }
    }
    const data = await response.json().catch(() => null) as { token?: unknown } | null
    if (typeof data?.token !== 'string' || !data.token) return { success: false, error: 'Login response missing token' }
    setJwt(data.token, true)
    return { success: true, token: data.token }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { success: false, error: 'Login timed out' }
    return { success: false, error: 'The server could not be reached' }
  }
}

/** End the session on the server (best effort) and forget it in every tab. */
export async function logoutSession(): Promise<void> {
  const token = jwt
  clearSession(true)
  if (!token) return
  try {
    await timedFetch(`${origin()}/api/v2/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    // The session ends on its own; the cookie is useless once the server forgets it.
  }
}

// --- OIDC: a full-page redirect to the provider and back -------------------------------------

interface PendingOidc {
  key: string
  scope: string
  state: string
  totp?: string
  at: number
}

/** What a sign-in that left the page came back with, for the Setup and Reauth views. */
export interface PendingSignIn {
  providerKey: string
  /** The server asked for a TOTP code: ask for it and start the sign-in again with it. */
  totpRequired?: boolean
  error?: string
}

let returned: PendingSignIn | null = null

/** The address the provider sends the browser back to; register it once at the provider. */
export function oidcRedirectUri(providerKey: string): string {
  return `${origin()}/auth/openid/${encodeURIComponent(providerKey)}`
}

/**
 * Leave for the provider's sign-in page. The page unloads, so the promise never settles; the
 * sign-in continues in `finishOidcRedirect` when the browser comes back.
 */
export function beginOidcSignIn(provider: OIDCProvider, totpPasscode?: string): Promise<never> {
  const pending: PendingOidc = {
    key: provider.key,
    scope: provider.scope,
    state: crypto.randomUUID(),
    ...(totpPasscode ? { totp: totpPasscode } : {}),
    at: Date.now(),
  }
  sessionStorage.setItem(PENDING_OIDC_KEY, JSON.stringify(pending))
  window.location.assign(buildAuthorizationUrl(provider, oidcRedirectUri(provider.key), pending.state))
  return new Promise<never>(() => {})
}

function readPending(): PendingOidc | null {
  try {
    const raw = sessionStorage.getItem(PENDING_OIDC_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PendingOidc>
    if (typeof value.key !== 'string' || typeof value.state !== 'string' || typeof value.scope !== 'string') return null
    // A sign-in older than ten minutes is not this visit's.
    if (typeof value.at !== 'number' || Date.now() - value.at > 10 * 60_000) return null
    return value as PendingOidc
  } catch {
    return null
  }
}

/**
 * Called once when the page loads. When the address is the provider's answer to a sign-in this
 * tab started, the code is exchanged for a session and the address is cleaned up. Returns whether
 * a session was started.
 */
export async function finishOidcRedirect(): Promise<boolean> {
  const pending = readPending()
  if (!window.location.pathname.startsWith('/auth/openid/')) return false
  // Whatever happens next, the answer is used once and the address goes back to the app's own.
  sessionStorage.removeItem(PENDING_OIDC_KEY)
  const here = window.location.href
  window.history.replaceState(null, '', '/')
  if (!pending) return false

  const outcome = interpretRedirect(here, oidcRedirectUri(pending.key), pending.state, { errorPrefix: 'Sign-in failed' })
  if (outcome.kind === 'ignore') return false
  if (outcome.kind === 'error') {
    returned = { providerKey: pending.key, error: outcome.message }
    return false
  }
  try {
    const response = await timedFetch(`${origin()}/api/v2/auth/openid/${encodeURIComponent(pending.key)}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: outcome.code,
        scope: pending.scope,
        redirect_url: oidcRedirectUri(pending.key),
        ...(pending.totp ? { totp_passcode: pending.totp } : {}),
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const { errorCode, message } = parseVikunjaProblem(text, response.status)
      returned = isTotpChallenge(response.status, errorCode)
        ? { providerKey: pending.key, totpRequired: true, ...(pending.totp ? { error: message } : {}) }
        : { providerKey: pending.key, error: `Sign-in failed: ${message}` }
      return false
    }
    const data = await response.json().catch(() => null) as { token?: unknown } | null
    if (typeof data?.token !== 'string' || !data.token) {
      returned = { providerKey: pending.key, error: 'Sign-in failed: the server sent no session' }
      return false
    }
    setJwt(data.token, true)
    returned = { providerKey: pending.key }
    return true
  } catch {
    returned = { providerKey: pending.key, error: 'Sign-in failed: the server could not be reached' }
    return false
  }
}

/** What the last redirect came back with, once: the Setup and Reauth views pick up from it. */
export function takePendingSignIn(): PendingSignIn | null {
  const value = returned
  returned = null
  return value
}
