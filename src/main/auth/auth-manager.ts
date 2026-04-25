import { loadConfig } from '../config'
import { net } from 'electron'
import {
  getBestToken,
  getJWT,
  isJWTExpired,
  getAPIToken,
  isAPITokenExpired,
  hasAPIToken,
  hasRefreshToken,
  getAPITokenExpiry,
  clear,
  extractJWTExp,
  storeAPIToken,
} from './token-store'
import { loginWithOIDC, createBackupAPIToken } from './oidc-login'
import { silentReauth } from './silent-reauth'
import { loginWithPassword, type PasswordLoginResult } from './password-login'
import { renewJWT, JWTRenewalError, type JWTRenewalErrorKind } from './jwt-renewal'

// Re-auth 2 minutes before JWT expiry (Vikunja 2.0 uses ~10-min JWTs)
const REFRESH_BUFFER_SECONDS = 120

// Max time to wait for network-based token recovery at startup
const STARTUP_RECOVERY_TIMEOUT = 15_000

// Backoff settings for repeated refresh failures.
// Transient errors (network, 5xx) use exponential backoff. Rate-limit responses
// use a fixed minimum (server's Retry-After takes precedence if provided).
// Terminal errors (refresh token rejected AND silent reauth failed) stop
// auto-retry entirely until login / system resume.
const TRANSIENT_BACKOFF_BASE_MS = 5_000
const TRANSIENT_BACKOFF_MAX_MS = 120_000
const RATE_LIMIT_BACKOFF_DEFAULT_MS = 60_000
const RATE_LIMIT_BACKOFF_MAX_MS = 300_000

export type AuthInitResult = 'authenticated' | 'reauth-needed' | 'unconfigured'
type AuthEvent = 'auth-required'

class AuthManager {
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null
  private _refreshInProgress: Promise<string> | null = null
  private _listeners = new Set<(event: AuthEvent) => void>()

  // Earliest wall-clock time (ms) at which we're allowed to attempt another refresh.
  // 0 = no backoff in effect.
  private _nextAllowedRefreshAt = 0
  // Once true, the auth manager has given up on automatic recovery and won't
  // retry until login()/loginPassword()/onSystemResume() resets state.
  private _terminalFailure = false
  // Counter for exponential backoff on transient errors. Reset on success.
  private _consecutiveTransientFailures = 0

  /**
   * Check stored tokens and schedule proactive refresh if needed.
   * Call once at app startup.
   *
   * Returns:
   * - 'authenticated': valid tokens exist (or were recovered)
   * - 'reauth-needed': config is intact but tokens expired and recovery failed
   * - 'unconfigured': no config or not using OIDC/password auth
   */
  async initialize(): Promise<AuthInitResult> {
    const config = loadConfig()
    if (!config || (config.auth_method !== 'oidc' && config.auth_method !== 'password')) return 'unconfigured'

    const token = getBestToken()

    if (token) {
      // Happy path: valid local token exists
      if (!isJWTExpired() && !isJWTExpired(REFRESH_BUFFER_SECONDS)) {
        this._scheduleProactiveRefresh()
      } else if (isJWTExpired() && !isAPITokenExpired()) {
        // JWT expired but API token valid — trigger background refresh
        this._scheduleRefresh(0)
      }
      return 'authenticated'
    }

    // No valid local tokens — attempt network recovery (all auth methods)
    if (!config.vikunja_url) return 'unconfigured'

    console.log('[Auth] No valid local tokens, attempting startup recovery...')
    try {
      await this._doRefreshWithTimeout(STARTUP_RECOVERY_TIMEOUT)
      console.log('[Auth] Startup recovery succeeded')
      return 'authenticated'
    } catch (err) {
      console.warn('[Auth] Startup recovery failed:', err instanceof Error ? err.message : err)
      return 'reauth-needed'
    }
  }

  /**
   * Synchronous fast path — returns the best available token immediately.
   * If JWT is expired, queues background refresh and returns API token.
   */
  getTokenSync(): string | null {
    // 1. JWT valid? Return it
    if (!isJWTExpired()) {
      const jwt = getJWT()
      if (jwt) return jwt
    }

    // 2. JWT expired → return API token, queue silent re-auth
    if (!isAPITokenExpired()) {
      const apiToken = getAPIToken()
      if (apiToken) {
        // Schedule respects existing backoff/terminal state; safe to call per-request.
        this._scheduleRefresh(0)
        return apiToken
      }
    }

    // 3. No valid tokens
    return null
  }

  /**
   * Async token retrieval — attempts silent re-auth if JWT expired.
   */
  async getToken(): Promise<string> {
    // 1. JWT valid?
    if (!isJWTExpired()) {
      const jwt = getJWT()
      if (jwt) return jwt
    }

    // 2. Try silent re-auth — _doRefresh respects backoff/terminal state and
    //    rejects without making network calls when blocked.
    try {
      const jwt = await this._doRefresh()
      return jwt
    } catch {
      // Refresh failed (or skipped due to backoff) — fall through to API token.
    }

    // 3. Fall back to API token
    if (!isAPITokenExpired()) {
      const apiToken = getAPIToken()
      if (apiToken) return apiToken
    }

    // 4. No tokens available
    this._emit('auth-required')
    throw new Error('No valid authentication tokens available')
  }

  /**
   * Interactive OIDC login via system browser.
   */
  async login(vikunjaUrl: string, providerKey?: string): Promise<void> {
    await loginWithOIDC(vikunjaUrl, providerKey)
    this._resetBackoff()
    this._scheduleProactiveRefresh()
  }

  /**
   * Username/password login with optional TOTP.
   */
  async loginPassword(
    vikunjaUrl: string,
    username: string,
    password: string,
    totpPasscode?: string
  ): Promise<PasswordLoginResult> {
    const result = await loginWithPassword(vikunjaUrl, username, password, totpPasscode)
    if (result.success) {
      this._resetBackoff()
      this._scheduleProactiveRefresh()
    }
    return result
  }

  /**
   * Clear all stored tokens and stop refresh timer.
   * Also destroys the server-side session (Vikunja 2.0+; best-effort).
   */
  async logout(): Promise<void> {
    this._cancelRefreshTimer()
    this._refreshInProgress = null
    this._resetBackoff()

    // Best-effort server-side logout (Vikunja 2.0+)
    // On pre-2.0 servers this returns 404 — caught and ignored.
    try {
      const config = loadConfig()
      const jwt = getJWT()
      if (config?.vikunja_url && jwt) {
        const baseUrl = config.vikunja_url.replace(/\/+$/, '')
        await net.fetch(`${baseUrl}/api/v1/user/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}` },
        }).catch(() => {})
      }
    } catch {
      // Swallow — local cleanup is what matters
    }

    clear()
  }

  /**
   * Called when the system resumes from sleep/hibernate.
   * Cancels stale timers, clears any backoff state (network may be back),
   * and triggers refresh if the JWT expired during sleep.
   */
  onSystemResume(): void {
    this._cancelRefreshTimer()
    this._resetBackoff()

    if (!isJWTExpired()) {
      // JWT still valid — just reschedule proactive refresh
      this._scheduleProactiveRefresh()
      return
    }

    // JWT expired during sleep — trigger immediate refresh
    this._doRefresh()
      .then(() => {
        console.log('[Auth] Post-resume refresh succeeded')
      })
      .catch((err) => {
        console.warn('[Auth] Post-resume refresh failed:', err instanceof Error ? err.message : err)
        // Even if refresh fails, API token covers us. _doRefresh's failure
        // handler has already set up appropriate backoff or terminal state.
      })
  }

  /**
   * Subscribe to auth events. Returns unsubscribe function.
   */
  on(listener: (event: AuthEvent) => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  private _emit(event: AuthEvent): void {
    for (const listener of this._listeners) {
      listener(event)
    }
  }

  private _cancelRefreshTimer(): void {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer)
      this._refreshTimer = null
    }
  }

  /** Returns the delay (ms, ≥0) we must wait before the next refresh attempt. */
  private _backoffRemainingMs(): number {
    return Math.max(0, this._nextAllowedRefreshAt - Date.now())
  }

  private _resetBackoff(): void {
    this._nextAllowedRefreshAt = 0
    this._terminalFailure = false
    this._consecutiveTransientFailures = 0
  }

  /**
   * Schedule a refresh after `delayMs` milliseconds.
   * Clamps to outstanding backoff so callers (e.g. per-IPC `getTokenSync`)
   * cannot race the timer down to 0ms.
   * No-op when in terminal failure state.
   */
  private _scheduleRefresh(delayMs: number): void {
    if (this._terminalFailure) return
    const effective = Math.max(delayMs, this._backoffRemainingMs())
    this._cancelRefreshTimer()
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null
      this._doRefresh().catch((err) => {
        console.warn('[Auth] Scheduled refresh failed:', err instanceof Error ? err.message : err)
        // Reschedule so we keep trying — failure handler has already updated
        // backoff/terminal state, and _scheduleProactiveRefresh respects it.
        if (!this._terminalFailure) {
          this._scheduleProactiveRefresh()
        }
      })
    }, effective)
  }

  /**
   * Schedule refresh for ~2 minutes before JWT expiry (or sooner if the JWT is
   * already within the buffer). No-op when in terminal failure state.
   */
  private _scheduleProactiveRefresh(): void {
    if (this._terminalFailure) return

    if (isJWTExpired(REFRESH_BUFFER_SECONDS)) {
      // Already within buffer — refresh as soon as backoff allows.
      this._scheduleRefresh(0)
      return
    }

    // JWT valid and not within buffer — check again in 2 minutes.
    const checkInterval = 2 * 60 * 1000
    this._cancelRefreshTimer()
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null
      if (this._terminalFailure) return
      if (isJWTExpired(REFRESH_BUFFER_SECONDS)) {
        this._doRefresh()
          .then(() => this._scheduleProactiveRefresh())
          .catch(() => {
            // Failure handler has updated backoff state; reschedule respects it.
            this._scheduleProactiveRefresh()
          })
      } else {
        this._scheduleProactiveRefresh()
      }
    }, checkInterval)
  }

  /**
   * Wrap _doRefresh() with a timeout for startup recovery.
   * Prevents the app from hanging indefinitely if the server is unreachable.
   */
  private _doRefreshWithTimeout(timeoutMs: number): Promise<string> {
    let timer: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Startup recovery timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    })
    return Promise.race([
      this._doRefresh().finally(() => clearTimeout(timer!)),
      timeoutPromise,
    ])
  }

  /**
   * Perform token refresh. Deduplicates concurrent calls and respects backoff.
   *
   * Strategy:
   * 1. If terminal failure or active backoff: reject without any network call.
   * 2. Otherwise call `renewJWT` (Vikunja 2.0+ refresh-token endpoint).
   * 3. On `no-refresh-token` (pre-2.0 servers): for OIDC, fall through to
   *    silent reauth.
   * 4. On `unauthorized` (refresh token rejected): for OIDC, attempt silent
   *    reauth — the IdP session may still be alive. If silent reauth also
   *    fails → terminal.
   * 5. On `rate-limited` / `server-error` / `network-error`: do NOT call silent
   *    reauth (won't help and creates a hidden BrowserWindow on every attempt);
   *    schedule transient backoff and let the timer retry later.
   */
  private _doRefresh(): Promise<string> {
    if (this._refreshInProgress) {
      return this._refreshInProgress
    }
    if (this._terminalFailure) {
      return Promise.reject(new Error('Refresh disabled: terminal auth failure'))
    }
    const remaining = this._backoffRemainingMs()
    if (remaining > 0) {
      return Promise.reject(new Error(`Refresh backoff: ${remaining}ms remaining`))
    }

    const config = loadConfig()
    if (!config?.vikunja_url) {
      return Promise.reject(new Error('No Vikunja URL configured'))
    }

    const vikunjaUrl = config.vikunja_url
    const authMethod = config.auth_method

    const refreshPromise = (async (): Promise<string> => {
      let renewError: JWTRenewalError
      try {
        return await renewJWT(vikunjaUrl)
      } catch (err) {
        renewError =
          err instanceof JWTRenewalError
            ? err
            : new JWTRenewalError(
                err instanceof Error ? err.message : String(err),
                'network-error',
              )
      }

      // Decide whether silent reauth is worth attempting.
      const tryingSilentReauth =
        authMethod === 'oidc' &&
        (renewError.kind === 'no-refresh-token' || renewError.kind === 'unauthorized')

      if (!tryingSilentReauth) {
        throw renewError
      }

      try {
        return await silentReauth(vikunjaUrl)
      } catch (silentErr) {
        // Both renewJWT and silent reauth failed. Treat as unauthorized so the
        // failure handler emits auth-required and stops auto-retry.
        const message = silentErr instanceof Error ? silentErr.message : String(silentErr)
        throw new JWTRenewalError(
          `Silent reauth failed after ${renewError.kind}: ${message}`,
          'unauthorized',
          renewError.status,
        )
      }
    })()

    this._refreshInProgress = refreshPromise
      .then((jwt) => {
        this._refreshInProgress = null
        this._resetBackoff()
        this._scheduleProactiveRefresh()
        // Ensure backup API token exists after every successful refresh.
        // This is load-bearing: without a valid API token, a failed refresh
        // leaves the user at the "Session Expired" screen with no fallback.
        // We use console.error (not warn) so failures are visible in packaged
        // logs and can be diagnosed when users report lockouts.
        this._ensureBackupAPIToken(jwt).catch((err) => {
          console.error(
            '[Auth] CRITICAL: failed to ensure backup API token — user will be locked out on next refresh failure:',
            err instanceof Error ? err.message : err
          )
        })
        return jwt
      })
      .catch((err) => {
        this._refreshInProgress = null
        this._handleRefreshFailure(err)
        throw err
      })

    return this._refreshInProgress
  }

  /**
   * Map a refresh failure to backoff or terminal state. Idempotent.
   */
  private _handleRefreshFailure(err: unknown): void {
    const kind: JWTRenewalErrorKind =
      err instanceof JWTRenewalError ? err.kind : 'network-error'
    const retryAfterSec =
      err instanceof JWTRenewalError ? err.retryAfterSec : undefined

    switch (kind) {
      case 'unauthorized': {
        // Terminal: refresh token is rejected and (for OIDC) silent reauth also
        // failed. Stop auto-retry and prompt the user to re-authenticate.
        this._terminalFailure = true
        this._consecutiveTransientFailures = 0
        this._cancelRefreshTimer()
        this._emit('auth-required')
        return
      }
      case 'rate-limited': {
        // Honor server's Retry-After if reasonable; otherwise default to 60s.
        // Cap at 5 minutes so a stuck header doesn't break recovery on resume.
        const requested = retryAfterSec != null ? retryAfterSec * 1000 : RATE_LIMIT_BACKOFF_DEFAULT_MS
        const ms = Math.min(Math.max(requested, RATE_LIMIT_BACKOFF_DEFAULT_MS), RATE_LIMIT_BACKOFF_MAX_MS)
        this._nextAllowedRefreshAt = Date.now() + ms
        // Don't increment transient failure count — rate limits are a server signal,
        // not a service health problem.
        return
      }
      case 'no-refresh-token':
      case 'server-error':
      case 'network-error': {
        this._consecutiveTransientFailures += 1
        const expBackoff =
          TRANSIENT_BACKOFF_BASE_MS * 2 ** (this._consecutiveTransientFailures - 1)
        const ms = Math.min(expBackoff, TRANSIENT_BACKOFF_MAX_MS)
        this._nextAllowedRefreshAt = Date.now() + ms
        return
      }
    }
  }

  /**
   * Ensure a backup API token exists and is not expiring soon.
   * Creates one if missing, renews if within 30 days of expiry.
   * Runs async — does not block the caller.
   */
  private async _ensureBackupAPIToken(jwt: string): Promise<void> {
    const config = loadConfig()
    if (!config?.vikunja_url) return

    const THIRTY_DAYS = 30 * 24 * 60 * 60

    if (hasAPIToken()) {
      const expiry = getAPITokenExpiry()
      // If expiry is unknown or more than 30 days away, skip
      if (expiry != null && expiry - Date.now() / 1000 > THIRTY_DAYS) {
        return
      }
      // Within 30 days of expiry (or expiry unknown) — renew
      console.log('[Auth] Backup API token expiring soon, renewing')
    } else {
      console.log('[Auth] No backup API token found, creating one')
    }

    const baseUrl = config.vikunja_url.replace(/\/+$/, '')
    try {
      await createBackupAPIToken(baseUrl, jwt)
    } catch (err) {
      // Fallback: if the JWT is long-lived (>24h, pre-2.0 Vikunja),
      // store it as the backup API token.
      const jwtExp = extractJWTExp(jwt)
      if (jwtExp != null) {
        const lifetimeSeconds = jwtExp - Date.now() / 1000
        if (lifetimeSeconds > 24 * 60 * 60) {
          console.log('[Auth] JWT is long-lived, storing as backup API token')
          storeAPIToken(jwt, jwtExp)
          return
        }
      }
      throw err
    }
  }
}

export const authManager = new AuthManager()
