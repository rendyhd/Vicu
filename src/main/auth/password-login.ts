import { net } from 'electron'
import { storeJWT, storeRefreshToken, storeAPIToken, extractJWTExp } from './token-store'
import { extractRefreshToken } from './cookie-utils'
import { createBackupAPIToken } from './oidc-login'
import { loadConfig, saveConfig } from '../config'

const LOGIN_TIMEOUT = 15_000

interface LoginSuccess {
  success: true
  token: string
}

interface LoginFailure {
  success: false
  error: string
  totpRequired?: boolean
}

export type PasswordLoginResult = LoginSuccess | LoginFailure

/**
 * Log in to Vikunja with username/password (and optional TOTP code).
 *
 * On success: stores the JWT via token-store and fire-and-forget creates
 * a backup 365-day API token (same pattern as OIDC).
 *
 * On 412: returns totpRequired so the UI can prompt for a TOTP code.
 */
export async function loginWithPassword(
  vikunjaUrl: string,
  username: string,
  password: string,
  totpPasscode?: string
): Promise<PasswordLoginResult> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT)

    const body: Record<string, unknown> = {
      username,
      password,
      long_token: true,
    }
    if (totpPasscode) {
      body.totp_passcode = totpPasscode
    }

    const response = await net.fetch(`${baseUrl}/api/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (response.status === 412) {
      return { success: false, error: 'TOTP required', totpRequired: true }
    }

    if (response.status === 403) {
      return { success: false, error: 'Invalid username or password' }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = `Login failed (${response.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed.message) message = parsed.message
      } catch { /* use default */ }
      return { success: false, error: message }
    }

    const data: { token?: string } = await response.json()
    const jwt = data.token
    if (!jwt) {
      return { success: false, error: 'Login response missing token' }
    }

    // Store JWT
    storeJWT(jwt)

    // Capture refresh token from Set-Cookie (Vikunja 2.0+; harmlessly null on pre-2.0)
    const refreshToken = extractRefreshToken(response)
    if (refreshToken) {
      storeRefreshToken(refreshToken)
    }

    // Create backup API token (awaited, but login succeeds even if this fails)
    try {
      await createBackupAPIToken(baseUrl, jwt)
    } catch (err) {
      console.warn('[Password] Failed to create backup API token:', err)
      // Fallback: if the JWT itself is long-lived (>24h, i.e. pre-2.0 Vikunja),
      // store it as the backup API token so we survive restarts.
      const jwtExp = extractJWTExp(jwt)
      if (jwtExp != null) {
        const lifetimeSeconds = jwtExp - Date.now() / 1000
        if (lifetimeSeconds > 24 * 60 * 60) {
          console.log('[Password] JWT is long-lived, storing as backup API token')
          storeAPIToken(jwt, jwtExp)
        }
      }
    }

    // Persist username for re-login screen
    try {
      const config = loadConfig()
      if (config) {
        config.last_username = username
        saveConfig(config)
      }
    } catch { /* non-critical */ }

    return { success: true, token: jwt }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: 'Login timed out' }
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Login failed',
    }
  }
}

