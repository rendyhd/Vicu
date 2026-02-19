import { net } from 'electron'
import { getJWT, storeJWT } from './token-store'

const RENEWAL_TIMEOUT = 10_000

/**
 * Renew the current JWT via `POST /api/v1/user/token`.
 * Reads the current JWT from the store, calls the endpoint, and stores the new JWT.
 * Throws on failure.
 */
export async function renewJWT(vikunjaUrl: string): Promise<string> {
  const currentJWT = getJWT()
  if (!currentJWT) {
    throw new Error('No JWT available for renewal')
  }

  const baseUrl = vikunjaUrl.replace(/\/+$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RENEWAL_TIMEOUT)

  try {
    const response = await net.fetch(`${baseUrl}/api/v1/user/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentJWT}`,
      },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`JWT renewal failed (${response.status}): ${text}`)
    }

    const data: { token?: string } = await response.json()
    const newJWT = data.token
    if (!newJWT) {
      throw new Error('JWT renewal response missing token')
    }

    storeJWT(newJWT)
    return newJWT
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}
