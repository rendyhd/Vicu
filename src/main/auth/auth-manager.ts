import { loadConfig } from '../config'
import {
  getBestToken,
  getJWT,
  isJWTExpired,
  getAPIToken,
  isAPITokenExpired,
  clear,
} from './token-store'
import { loginWithOIDC } from './oidc-login'
import { silentReauth } from './silent-reauth'
import { loginWithPassword, type PasswordLoginResult } from './password-login'
import { renewJWT } from './jwt-renewal'

// Re-auth 1 hour before JWT expiry
const REFRESH_BUFFER_SECONDS = 3600

type AuthEvent = 'auth-required'

class AuthManager {
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null
  private _refreshInProgress: Promise<string> | null = null
  private _listeners = new Set<(event: AuthEvent) => void>()

  /**
   * Check stored tokens and schedule proactive refresh if needed.
   * Call once at app startup.
   */
  async initialize(): Promise<boolean> {
    const config = loadConfig()
    if (!config || (config.auth_method !== 'oidc' && config.auth_method !== 'password')) return false

    const token = getBestToken()
    if (!token) return false

    // If JWT is present but expiring soon, schedule refresh
    if (!isJWTExpired() && !isJWTExpired(REFRESH_BUFFER_SECONDS)) {
      this._scheduleProactiveRefresh()
    } else if (isJWTExpired() && !isAPITokenExpired()) {
      // JWT expired but API token valid — trigger background refresh
      this._scheduleRefresh(0)
    }

    return true
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
   */
  logout(): void {
    this._cancelRefreshTimer()
    this._refreshInProgress = null
    clear()
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
      this._doRefresh().catch(() => {
        // Silent refresh failed — API token still covers us
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
    // Use a simpler approach: check every 5 minutes
    const checkInterval = 5 * 60 * 1000
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
   * Perform silent re-auth. Deduplicates concurrent calls.
   */
  private _doRefresh(): Promise<string> {
    if (this._refreshInProgress) {
      return this._refreshInProgress
    }

    const config = loadConfig()
    if (!config?.vikunja_url) {
      return Promise.reject(new Error('No Vikunja URL configured'))
    }

    const refreshPromise =
      config.auth_method === 'password'
        ? renewJWT(config.vikunja_url)
        : silentReauth(config.vikunja_url)

    this._refreshInProgress = refreshPromise
      .then((jwt) => {
        this._refreshInProgress = null
        this._scheduleProactiveRefresh()
        return jwt
      })
      .catch((err) => {
        this._refreshInProgress = null
        throw err
      })

    return this._refreshInProgress
  }
}

export const authManager = new AuthManager()
