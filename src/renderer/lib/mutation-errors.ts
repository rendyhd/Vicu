import { isAuthError, isRetriableError } from './error-classify'

/**
 * An API failure that keeps the HTTP status, so the message shown to the user can say what kind of
 * problem it was (D-REN-3). Mutation helpers throw this instead of a bare `Error`.
 */
export class ApiError extends Error {
  readonly statusCode?: number
  /** A create that failed in a way that may still have created the task: the message says so and must be shown as it is. */
  readonly mayExist: boolean

  constructor(message: string, statusCode?: number, mayExist = false) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.mayExist = mayExist
  }
}

export function apiError(result: { error: string; statusCode?: number; mayExist?: boolean }): ApiError {
  return new ApiError(result.error, result.statusCode, result.mayExist === true)
}

export type FailureKind = 'offline' | 'auth' | 'forbidden' | 'not-found' | 'rate-limit' | 'server' | 'rejected' | 'unknown'

export interface MutationFailure {
  kind: FailureKind
  /** A sentence the user can act on; never a raw stack or an Electron error code. */
  message: string
}

/** Strip the wrapping Electron adds around IPC errors, and cap what a server can make us show. */
function cleanMessage(raw: string): string {
  const text = raw
    .replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, '')
    .replace(/^Error:\s*/, '')
    .trim()
  return text.length > 200 ? `${text.slice(0, 197)}...` : text
}

/**
 * Turn a failed mutation into a readable reason. Network and server problems are explained rather
 * than echoed, and a rejection keeps the server's own words because they name the field or rule.
 */
export function describeMutationError(error: unknown): MutationFailure {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const status = error instanceof ApiError ? error.statusCode : undefined
  const text = cleanMessage(raw)

  // "The task may already have been created; check before retrying": not softened into "try again".
  if (error instanceof ApiError && error.mayExist && text) return { kind: 'unknown', message: text }

  if (status === 401 || isAuthError(raw)) {
    return { kind: 'auth', message: 'Your session has expired. Sign in again to keep syncing.' }
  }
  if (status === 403) return { kind: 'forbidden', message: "You don't have permission to do that." }
  if (status === 404) return { kind: 'not-found', message: 'That item no longer exists. It may have been deleted elsewhere.' }
  if (status === 429) return { kind: 'rate-limit', message: 'The server is busy. Try again in a moment.' }
  if (status !== undefined && status >= 500) {
    return { kind: 'server', message: `The server had a problem (HTTP ${status}). Try again in a moment.` }
  }
  if (status === undefined && isRetriableError(raw)) {
    return { kind: 'offline', message: "Can't reach the server. Check your connection and try again." }
  }
  if (status !== undefined) return { kind: 'rejected', message: text || `The server refused the change (HTTP ${status}).` }
  return { kind: 'unknown', message: text || 'Something went wrong. Try again.' }
}

/** What a mutation can say about itself to the global error handler. */
export interface MutationMeta {
  /** The mutation shows its own error (an inline message, a dialog): no toast. */
  silent?: boolean
  /** Names what failed, e.g. "complete the task"; used as "Could not complete the task: ...". */
  action?: string
  [key: string]: unknown
}

export interface ErrorToast {
  kind: FailureKind
  message: string
}

/**
 * The global `MutationCache.onError` decision (D-REN-3): which failed mutations get a toast, and
 * with what text. A change that was queued offline never throws, so it never gets here.
 */
export function toastForMutationError(error: unknown, meta: MutationMeta | undefined): ErrorToast | null {
  if (meta?.silent === true) return null
  const failure = describeMutationError(error)
  const action = typeof meta?.action === 'string' && meta.action ? meta.action : null
  return {
    kind: failure.kind,
    message: action ? `Could not ${action}: ${failure.message}` : failure.message,
  }
}
