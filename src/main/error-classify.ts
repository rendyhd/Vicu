/** Errors worth retrying later / serving cache for (network-ish failures). */
export function isRetriableError(error: string): boolean {
  if (!error) return false
  const patterns = [
    'timed out', 'Network error', 'network error', 'net::',
    'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH', 'fetch failed', 'socket hang up',
    'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE',
  ]
  return patterns.some((p) => error.includes(p))
}

/**
 * Errors where the request provably never reached the server (safe to queue
 * a non-idempotent create for replay without risking a duplicate).
 * Note: timeouts and resets are deliberately excluded — those requests may
 * have been received and applied server-side.
 */
export function isConnectionError(error: string): boolean {
  if (!error) return false
  const patterns = [
    'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE',
    'ERR_NETWORK_CHANGED', 'ERR_CONNECTION_TIMED_OUT',
  ]
  return patterns.some((p) => error.includes(p))
}

export function isAuthError(error: string): boolean {
  if (!error) return false
  return (
    error.includes('API token is invalid') ||
    error.includes('API token has insufficient') ||
    error.includes('API token lacks') ||
    error.includes('Session expired')
  )
}
