import { net } from 'electron'
import { vikunjaUserAgent } from '../user-agent'

export interface VikunjaUser {
  id: number
  username: string
  email: string
  name: string
  /** Vikunja's own default project (user settings); only ever read, a suggestion for the Inbox. */
  default_project_id?: number
  /**
   * Vikunja's own week start, 0 Sunday to 6 Saturday. Only ever read: the "Week starts on" setting
   * offers it. Never followed by itself, because an account that never set it reads 0 (contract 2.1).
   */
  week_start?: number
}

const FETCH_TIMEOUT = 10_000

/**
 * Fetch the current user's info from `GET /api/v2/user`.
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

    const response = await net.fetch(`${baseUrl}/api/v2/user`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': vikunjaUserAgent() },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) return null

    const data = await response.json() as {
      id: number
      username: string
      email?: string
      name?: string
      settings?: { default_project_id?: unknown; week_start?: unknown } | null
    }
    const defaultProject = data.settings?.default_project_id
    const weekStart = data.settings?.week_start
    return {
      id: data.id,
      username: data.username,
      email: data.email ?? '',
      name: data.name ?? data.username,
      ...(typeof defaultProject === 'number' && Number.isInteger(defaultProject) && defaultProject > 0
        ? { default_project_id: defaultProject }
        : {}),
      ...(typeof weekStart === 'number' && Number.isInteger(weekStart) && weekStart >= 0 && weekStart <= 6
        ? { week_start: weekStart }
        : {}),
    }
  } catch {
    return null
  }
}
