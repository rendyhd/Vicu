import { net } from 'electron'
import { getRefreshToken, storeJWT, storeRefreshToken } from './token-store'
import { extractRefreshToken } from './cookie-utils'

const RENEWAL_TIMEOUT = 10_000

/**
 * Renew the current JWT via `POST /api/v1/user/token/refresh`.
 *
 * Vikunja 2.0+ uses short-lived JWTs with a rotating refresh token delivered
 * via Set-Cookie. We send the stored refresh token as a Cookie header and
 * parse the rotated one from the response.
 *
 * Throws immediately if no refresh token is stored (pre-2.0 servers never
 * set one, so no HTTP call is made — callers fall back to other strategies).
 */
export async function renewJWT(vikunjaUrl: string): Promise<string> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new Error('No refresh token available')
  }

  const baseUrl = vikunjaUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RENEWAL_TIMEOUT)

  try {
    const response = await net.fetch(`${baseUrl}/api/v1/user/token/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `vikunja_refresh_token=${refreshToken}`,
      },
      credentials: 'omit',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`JWT refresh failed (${response.status}): ${text}`)
    }

    // Store rotated refresh token from Set-Cookie
    const newRefreshToken = extractRefreshToken(response)
    if (newRefreshToken) {
      storeRefreshToken(newRefreshToken)
    }

    const data: { token?: string } = await response.json()
    const newJWT = data.token
    if (!newJWT) {
      throw new Error('JWT refresh response missing token')
    }

    storeJWT(newJWT)
    return newJWT
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}
