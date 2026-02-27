const REFRESH_TOKEN_NAME = 'vikunja_refresh_token'

/**
 * Extract the Vikunja refresh token from a response's Set-Cookie headers.
 *
 * Uses `response.headers.getSetCookie()` (available in Electron 33+ / Node 20+)
 * to parse `vikunja_refresh_token=<value>` from Set-Cookie headers.
 *
 * Returns `null` if the header is missing (backward compat with pre-2.0 servers).
 */
export function extractRefreshToken(response: Response): string | null {
  try {
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      const match = cookie.match(
        new RegExp(`^${REFRESH_TOKEN_NAME}=([^;]+)`)
      )
      if (match?.[1]) {
        return match[1]
      }
    }
  } catch {
    // getSetCookie() not available or other error — ignore
  }
  return null
}
