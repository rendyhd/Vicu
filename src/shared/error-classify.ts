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

/** What a failed API call looks like to the classifiers: the message and, when the server answered, the status. */
export interface FailureLike {
  error: string
  statusCode?: number
}

/**
 * Whether a failed change should go into the offline queue instead of being reported as an error
 * (D-SYNC-6). Only failures that say nothing about the change itself qualify: the network is down,
 * the server is down or overloaded. A 4xx means the server looked at the change and said no, and
 * an auth failure needs the user, so neither is queued.
 *
 * A create is stricter because it is not idempotent: it is queued only when the request provably
 * never created anything. A timeout or a 500 may have been applied, and replaying it would add a
 * duplicate. Gateway errors (502/503/504) mean the proxy answered but Vikunja never saw the
 * request, and 429 means the server refused it, so those are safe.
 */
export function isQueueableFailure(failure: FailureLike, kind: 'change' | 'create'): boolean {
  const status = failure.statusCode
  if (status === 401 || status === 403) return false
  if (isAuthError(failure.error)) return false

  if (kind === 'create') {
    if (status === 502 || status === 503 || status === 504 || status === 429) return true
    return status === undefined && isConnectionError(failure.error)
  }

  if (status !== undefined) return status >= 500 || status === 429 || status === 408
  return isRetriableError(failure.error)
}

/** Said when a create timed out: the request may have reached the server and been applied. */
export const CREATE_MAY_EXIST_TIMEOUT_MESSAGE =
  "The server didn't answer in time. The task may already have been created; check before retrying."

/**
 * What to tell the user when a create failed in a way that may still have created the task: the
 * request timed out, the connection dropped after it was sent, or the server answered with a 500.
 * Such a create is not queued (replaying it could add a duplicate), so the user has to decide, and
 * "try again" would add the task a second time if it exists. Null when the request provably created
 * nothing (it is queued instead) or the server refused it (a 4xx, an auth problem).
 */
export function maybeCreatedMessage(failure: FailureLike): string | null {
  if (isQueueableFailure(failure, 'create')) return null
  const status = failure.statusCode
  if (status !== undefined) {
    return status >= 500 ? 'The server reported an error. The task may already have been created; check before retrying.' : null
  }
  if (/timed out|ETIMEDOUT/i.test(failure.error)) return CREATE_MAY_EXIST_TIMEOUT_MESSAGE
  if (isRetriableError(failure.error)) return 'The connection was lost. The task may already have been created; check before retrying.'
  return null
}
