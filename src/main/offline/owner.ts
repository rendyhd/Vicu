/**
 * Which account a queued action was created for. The queue outlives a logout or a server switch,
 * and replaying one account's changes against another server (or user) would write them into the
 * wrong place, so every action records its owner and the replay refuses a mismatch.
 */
export interface OfflineOwner {
  /** The Vikunja server, normalized by `normalizeServerUrl`. */
  server: string
  /** The Vikunja user id when it was known; two owners with a known, different id never match. */
  userId?: number
}

/** Compare servers regardless of case, a trailing slash or a fragment. Text that is not a URL is only trimmed. */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host}${path}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

/** Same server, and the same user unless one side does not know the user. */
export function isSameOwner(stamp: OfflineOwner, current: OfflineOwner): boolean {
  if (stamp.server !== current.server) return false
  if (stamp.userId !== undefined && current.userId !== undefined && stamp.userId !== current.userId) return false
  return true
}

/** Parse a stored owner; anything malformed counts as "no owner" rather than failing the whole queue file. */
export function parseOwner(raw: unknown): OfflineOwner | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { server, userId } = raw as { server?: unknown; userId?: unknown }
  if (typeof server !== 'string' || server === '') return undefined
  return {
    server,
    ...(typeof userId === 'number' && Number.isInteger(userId) && userId > 0 ? { userId } : {}),
  }
}
