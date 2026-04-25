import { net } from 'electron'
import { getRefreshToken, storeJWT, storeRefreshToken } from './token-store'
import { extractRefreshToken } from './cookie-utils'

const RENEWAL_TIMEOUT = 10_000

export type JWTRenewalErrorKind =
  | 'no-refresh-token'
  | 'rate-limited'
  | 'unauthorized'
  | 'server-error'
  | 'network-error'

/**
 * Typed failure from `renewJWT`. Callers branch on `kind` to decide whether to
 * retry, back off, fall through to silent reauth, or give up.
 */
export class JWTRenewalError extends Error {
  readonly kind: JWTRenewalErrorKind
  readonly status?: number
  readonly retryAfterSec?: number

  constructor(message: string, kind: JWTRenewalErrorKind, status?: number, retryAfterSec?: number) {
    super(message)
    this.name = 'JWTRenewalError'
    this.kind = kind
    this.status = status
    this.retryAfterSec = retryAfterSec
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  // Numeric seconds form (RFC 9110). Reject the HTTP-date form — Vikunja doesn't emit it.
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return n
  return undefined
}

function classifyHttpStatus(status: number): JWTRenewalErrorKind {
  if (status === 429) return 'rate-limited'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status >= 500) return 'server-error'
  // Other 4xx (e.g. 400 invalid_grant) — refresh token is no good.
  return 'unauthorized'
}

/**
 * Renew the current JWT via `POST /api/v1/user/token/refresh`.
 *
 * Vikunja 2.0+ uses short-lived JWTs with a rotating refresh token delivered
 * via Set-Cookie. We send the stored refresh token as a Cookie header and
 * parse the rotated one from the response.
 *
 * Throws a `JWTRenewalError` with a typed `kind` on every failure path,
 * including the pre-2.0 case where no refresh token is stored (no HTTP call
 * is made — callers fall back to other strategies).
 */
export async function renewJWT(vikunjaUrl: string): Promise<string> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new JWTRenewalError('No refresh token available', 'no-refresh-token')
  }

  const baseUrl = vikunjaUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RENEWAL_TIMEOUT)

  let response: Response
  try {
    response = await net.fetch(`${baseUrl}/api/v1/user/token/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `vikunja_refresh_token=${refreshToken}`,
      },
      credentials: 'omit',
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JWTRenewalError('JWT refresh timed out', 'network-error')
    }
    throw new JWTRenewalError(
      err instanceof Error ? err.message : String(err),
      'network-error',
    )
  }
  clearTimeout(timer)

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    const kind = classifyHttpStatus(response.status)
    const retryAfterSec =
      kind === 'rate-limited' ? parseRetryAfter(response.headers.get('Retry-After')) : undefined
    throw new JWTRenewalError(
      `JWT refresh failed (${response.status}): ${text}`,
      kind,
      response.status,
      retryAfterSec,
    )
  }

  // Store rotated refresh token from Set-Cookie
  const newRefreshToken = extractRefreshToken(response)
  if (newRefreshToken) {
    storeRefreshToken(newRefreshToken)
  }

  let data: { token?: string }
  try {
    data = (await response.json()) as { token?: string }
  } catch (err) {
    throw new JWTRenewalError(
      `JWT refresh response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      'server-error',
      response.status,
    )
  }
  const newJWT = data.token
  if (!newJWT) {
    throw new JWTRenewalError(
      'JWT refresh response missing token',
      'server-error',
      response.status,
    )
  }

  storeJWT(newJWT)
  return newJWT
}
