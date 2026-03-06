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
} from './token-store'
import { loginWithOIDC, createBackupAPIToken } from './oidc-login'
import { silentReauth } from './silent-reauth'
import { loginWithPassword, type PasswordLoginResult } from './password-login'
import { renewJWT } from './jwt-renewal'

// Re-auth 2 minutes before JWT expiry (Vikunja 2.0 uses ~10-min JWTs)
const REFRESH_BUFFER_SECONDS = 120

// Max time to wait for network-based token recovery at startup
const STARTUP_RECOVERY_TIMEOUT = 15_000

type AuthEvent = 'auth-required'

class AuthManager {
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null
  private _refreshInProgress: Promise<string> | null = null
  private _listeners = new Set<(event: AuthEvent) => void>()

  /**
   * Check stored tokens and schedule proactive refresh if needed.
   * Call once at app startup.
   *
   * If no valid local tokens exist, attempts network-based recovery
   * (refresh token → silent OIDC reauth) before giving up.
   */
  async initialize(): Promise<boolean> {
    const config = loadConfig()
    if (!config || (config.auth_method !== 'oidc' && config.auth_method !== 'password')) return false

    const token = getBestToken()

    if (token) {
      // Happy path: valid local token exists
      if (!isJWTExpired() && !isJWTExpired(REFRESH_BUFFER_SECONDS)) {
        this._scheduleProactiveRefresh()
      } else if (isJWTExpired() && !isAPITokenExpired()) {
        // JWT expired but API token valid — trigger background refresh
        this._scheduleRefresh(0)
      }
      return true
    }

    // No valid local tokens — attempt network recovery
    if (!config.vikunja_url) return false
    if (!hasRefreshToken() && config.auth_method !== 'oidc') return false

    console.log('[Auth] No valid local tokens, attempting startup recovery...')
    try {
      await this._doRefreshWithTimeout(STARTUP_RECOVERY_TIMEOUT)
      console.log('[Auth] Startup recovery succeeded')
      return true
    } catch (err) {
      console.warn('[Auth] Startup recovery failed:', err instanceof Error ? err.message : err)
      return false
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

    // 2. Try silent re-auth
    try {
      const jwt = await this._doRefresh()
      return jwt
    } catch {
      // Silent re-auth failed
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
   * Cancels stale timers, checks JWT validity, and triggers refresh if needed.
   */
  onSystemResume(): void {
    this._cancelRefreshTimer()

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
        console.warn('[Auth] Post-resume refresh failed, rescheduling:', err)
        // Even if refresh fails, API token covers us. Reschedule so we try again later.
        this._scheduleProactiveRefresh()
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

  /**
   * Schedule a refresh after `delayMs` milliseconds.
   */
  private _scheduleRefresh(delayMs: number): void {
    this._cancelRefreshTimer()
    this._refreshTimer = setTimeout(() => {
      this._doRefresh().catch((err) => {
        console.warn('[Auth] Scheduled refresh failed:', err)
        // Reschedule so we keep trying
        this._scheduleProactiveRefresh()
      })
    }, delayMs)
  }

  /**
   * Schedule refresh for 1 hour before JWT expiry.
   */
  private _scheduleProactiveRefresh(): void {
    // Read the JWT to calculate time until refresh
    if (isJWTExpired(REFRESH_BUFFER_SECONDS)) {
      // Already within buffer — refresh now
      this._scheduleRefresh(0)
      return
    }

    // Calculate delay: (exp - buffer) - now
    // We need the raw exp, so use isJWTExpired logic inversely
    // JWT is valid and not within buffer, so we schedule for later
    // Use a simpler approach: check every 2 minutes
    const checkInterval = 2 * 60 * 1000
    this._cancelRefreshTimer()
    this._refreshTimer = setTimeout(() => {
      if (isJWTExpired(REFRESH_BUFFER_SECONDS)) {
        this._doRefresh()
          .then(() => this._scheduleProactiveRefresh())
          .catch(() => {
            // Will retry at next interval
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
   * Perform token refresh. Deduplicates concurrent calls.
   *
   * Strategy (unified for all auth methods):
   * 1. Try refresh token endpoint (Vikunja 2.0+) — works for both password and OIDC.
   *    On pre-2.0 servers this throws immediately ("No refresh token available")
   *    without making any HTTP call.
   * 2. If that fails and auth method is OIDC, fall back to silent reauth
   *    (BrowserWindow-based prompt=none flow).
   * 3. If that also fails, throw — caller falls back to API token.
   */
  private _doRefresh(): Promise<string> {
    if (this._refreshInProgress) {
      return this._refreshInProgress
    }

    const config = loadConfig()
    if (!config?.vikunja_url) {
      return Promise.reject(new Error('No Vikunja URL configured'))
    }

    const vikunjaUrl = config.vikunja_url
    const authMethod = config.auth_method

    const refreshPromise = (async (): Promise<string> => {
      // 1. Try refresh token endpoint first (Vikunja 2.0+)
      try {
        return await renewJWT(vikunjaUrl)
      } catch {
        // Refresh token not available or endpoint failed
      }

      // 2. OIDC fallback: silent reauth via BrowserWindow
      if (authMethod === 'oidc') {
        return await silentReauth(vikunjaUrl)
      }

      throw new Error('Token refresh failed')
    })()

    this._refreshInProgress = refreshPromise
      .then((jwt) => {
        this._refreshInProgress = null
        this._scheduleProactiveRefresh()
        // Ensure backup API token exists after every successful refresh
        this._ensureBackupAPIToken(jwt).catch((err) => {
          console.warn('[Auth] Failed to ensure backup API token:', err)
        })
        return jwt
      })
      .catch((err) => {
        this._refreshInProgress = null
        throw err
      })

    return this._refreshInProgress
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
    await createBackupAPIToken(baseUrl, jwt)
  }
}

export const authManager = new AuthManager()
