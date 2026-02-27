import { net } from 'electron'
import { storeJWT, storeAPIToken, storeRefreshToken } from './token-store'
import { extractRefreshToken } from './cookie-utils'

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

    // Fire-and-forget: create backup API token
    createBackupAPIToken(baseUrl, jwt).catch(() => {})

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

async function createBackupAPIToken(
  baseUrl: string,
  jwt: string
): Promise<void> {
  const expirationDate = new Date()
  expirationDate.setDate(expirationDate.getDate() + 365)

  const response = await net.fetch(`${baseUrl}/api/v1/tokens`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      title: 'Vicu Desktop',
      expiration_date: expirationDate.toISOString(),
    }),
  })

  if (!response.ok) return

  const data: { token: string } = await response.json()
  if (data.token) {
    const expiresAtUnix = Math.floor(expirationDate.getTime() / 1000)
    storeAPIToken(data.token, expiresAtUnix)
  }
}
