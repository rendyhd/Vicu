import { net } from 'electron'

export interface VikunjaUser {
  id: number
  username: string
  email: string
  name: string
}

const FETCH_TIMEOUT = 10_000

/**
 * Fetch the current user's info from `GET /api/v1/user`.
 * Returns null on failure.
 */
export async function fetchCurrentUser(
  vikunjaUrl: string,
  token: string
): Promise<VikunjaUser | null> {
  const baseUrl = vikunjaUrl.replace(/\/+$/, '')

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await net.fetch(`${baseUrl}/api/v1/user`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) return null

    const data = await response.json()
    return {
      id: data.id,
      username: data.username,
      email: data.email ?? '',
      name: data.name ?? data.username,
    }
  } catch {
    return null
  }
}
