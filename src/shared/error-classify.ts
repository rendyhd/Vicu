/**
 * Said when the connection failed after the server had begun its answer (the status line and
 * headers were in, the body was not): a network change (`net::ERR_NETWORK_CHANGED` when a Mac
 * wakes, Wi-Fi switches or a VPN connects), a reset, a proxy that cut the answer off. The server
 * received the request and very likely carried it out, so this is never "the request did not reach
 * the server", whatever the network error says.
 */
export const ANSWER_CUT_OFF_MESSAGE = 'The connection dropped while the server was answering'

/** The failure of a request whose answer was cut off; `netError` is Electron's message (`net::ERR_...`). */
export function answerCutOffMessage(netError: string): string {
  return netError ? `${ANSWER_CUT_OFF_MESSAGE} (${netError}).` : `${ANSWER_CUT_OFF_MESSAGE}.`
}

/** Whether a failure is an answer cut off after the server began it (`answerCutOffMessage`). */
export function isAnswerCutOff(error: string): boolean {
  return !!error && error.startsWith(ANSWER_CUT_OFF_MESSAGE)
}

/** Errors worth retrying later / serving cache for (network-ish failures). */
export function isRetriableError(error: string): boolean {
  if (!error) return false
  if (isAnswerCutOff(error)) return true
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
 * have been received and applied server-side. So is any error that came after the server began
 * its answer (`isAnswerCutOff`), even `ERR_NETWORK_CHANGED`.
 *
 * A certificate that does not verify (`net::ERR_CERT_...`) counts: the TLS handshake failed, so the
 * request was never sent. A network that puts its sign-in page in front of every HTTPS address (a
 * plane, a hotel) answers with a certificate of its own; the create waits for the real server.
 */
export function isConnectionError(error: string): boolean {
  if (!error) return false
  // The server had begun to answer, so the request reached it, whichever network error ended it.
  if (isAnswerCutOff(error)) return false
  const patterns = [
    'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_INTERNET_DISCONNECTED', 'ERR_ADDRESS_UNREACHABLE',
    'ERR_NETWORK_CHANGED', 'ERR_CONNECTION_TIMED_OUT',
    'ERR_CERT_', 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH',
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

/**
 * What a password or OIDC sign-in hears when the server answers 401 after the one refresh and retry.
 * Starts with "Session expired" so `isAuthError` recognises it.
 */
export const SESSION_ENDED_MESSAGE = 'Session expired. Your sign-in has ended; sign in again to keep syncing.'

/**
 * Said when the server answered a request with a status of 2xx but a web page (or anything else that
 * is not JSON) instead of the Vikunja API. Usually a sign-in proxy in front of Vikunja (Authelia,
 * Authentik, Cloudflare Access) whose session ran out: nothing reached Vikunja. The result carries
 * `notApiResponse: true`; classifiers look at that, never at this text.
 */
export const NOT_API_RESPONSE_MESSAGE =
  'The server answered with a web page instead of the Vikunja API. If a sign-in page protects your Vikunja server, sign in there in your browser, then try again.'

/**
 * Statuses with which something in front of Vikunja judges the request itself (malformed, too
 * large): sending it again cannot help, so these stay refusals whoever answered.
 */
const ABOUT_THE_REQUEST: ReadonlySet<number> = new Set([400, 413, 414, 431])

/** A body that is there and is neither a JSON object nor a JSON array. An empty body shows nothing. */
function isNotJson(body: string): boolean {
  const text = body.replace(/^[\s﻿]+/, '').trimEnd()
  if (text === '') return false
  if (text[0] !== '{' && text[0] !== '[') return true
  try {
    JSON.parse(text)
    return false
  } catch {
    return true
  }
}

/**
 * Whether an error answer did not come from Vikunja: the sign-in page of a network (a plane, a
 * hotel), the block page of a firewall or a reverse proxy. Vikunja never saw the request, so the
 * answer says nothing about the change or the session: the result carries `notApiResponse: true` and
 * no status, the change is kept and sent again later, and nobody is asked to sign in.
 *
 * It needs positive evidence, a 4xx with a body that is there and is not JSON, because Vikunja
 * answers every error with a JSON object. A 408, a 429 and every 5xx already mean "try again later"
 * by themselves and keep their status. The same rule as the mobile app's `NotApiResponse`; keep them
 * in step.
 */
export function isNotApiErrorAnswer(statusCode: number, body: string): boolean {
  if (statusCode < 400 || statusCode > 499) return false
  if (statusCode === 408 || statusCode === 429 || ABOUT_THE_REQUEST.has(statusCode)) return false
  return isNotJson(body)
}

/** What to say when such an answer has to be shown; `statusCode` is what the thing in between answered. */
export function notApiErrorMessage(statusCode: number): string {
  return `The answer did not come from your Vikunja server (HTTP ${statusCode}). A sign-in page of the network, a firewall or a proxy is probably in the way.`
}

/**
 * Whether the server answered a `q` search with this failure while the session still works: the
 * server's search is broken, not the connection or the sign-in. A ParadeDB `pg_search` extension
 * older than the library Postgres loads answers every search with a 500 ("function
 * paradedb.ctid_is_valid(tid) does not exist") while listings without `q` keep working, so the
 * carrier and archive reads list without `q` instead of failing (cross-app semantics 10.4).
 */
export function isBrokenSearch(failure: { statusCode?: number }): boolean {
  return failure.statusCode !== undefined && failure.statusCode !== 401
}

/** What a failed API call looks like to the classifiers: the message and, when the server answered, the status. */
export interface FailureLike {
  error: string
  statusCode?: number
  /** A 403 that stands for an API token without this permission (cross-app semantics 9.7). */
  tokenPermission?: boolean
  /** The answer was a page that is not the API (`NOT_API_RESPONSE_MESSAGE`, `isNotApiErrorAnswer`): handled like an unreachable server. */
  notApiResponse?: boolean
}

/**
 * Whether a failure means the server could not be reached (or something in front of it answered
 * instead): reads may fall back to the cache, changes may be queued.
 */
export function isUnreachableFailure(failure: FailureLike): boolean {
  if (failure.notApiResponse) return true
  return failure.statusCode === undefined && isRetriableError(failure.error)
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
  // A page from something in front of Vikunja (a sign-in proxy): nothing reached Vikunja, so even a
  // create is safe to queue.
  if (failure.notApiResponse) return true
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
