import { isAuthError, isRetriableError, type FailureLike } from '../../shared/error-classify'
import type { OfflineActionType, OfflineFailureReason, OfflineReplayStop } from '../../shared/offline-queue-types'

/** What the replay does with an action whose request failed (D-SYNC-1). */
export type ReplayDecision =
  /** The server will never accept this action: move it to the failed log. */
  | { kind: 'drop'; reason: OfflineFailureReason }
  /** The change is already in effect (task already deleted, label already attached). */
  | { kind: 'done' }
  /** Keep the action and everything behind it, stop the replay and try again later. */
  | { kind: 'stop'; why: OfflineReplayStop }

/**
 * Decide what a failed replay request means. The rule that replaced "drop anything that is not a
 * network error" (which lost queued changes whenever the session had expired or the server was
 * restarting): an action is dropped only when the server answered 400, 404, 409, 413 or 422,
 * because those say the action itself can never succeed. Everything that says something about the
 * connection, the session or the server's health keeps the action and stops the replay so order is
 * preserved.
 *
 * Auth is checked first and wins over the status: a 404 behind an expired session says nothing
 * about the task.
 */
export function classifyReplayFailure(failure: FailureLike, actionType: OfflineActionType): ReplayDecision {
  const status = failure.statusCode

  if (status === 401 || status === 403 || isAuthError(failure.error)) return { kind: 'stop', why: 'auth' }
  if (failure.error.includes('is not configured')) return { kind: 'stop', why: 'config' }

  if (status !== undefined) {
    if (status === 429) return { kind: 'stop', why: 'rate-limit' }
    if (status === 408) return { kind: 'stop', why: 'network' }
    if (status >= 500) return { kind: 'stop', why: 'server' }

    if (status === 404) {
      // Deleting or detaching something that is already gone has the effect the user wanted.
      if (actionType === 'delete' || actionType === 'remove-label') return { kind: 'done' }
      return { kind: 'drop', reason: actionType === 'create' ? 'not-found' : 'task-gone' }
    }
    if (status === 409) {
      return actionType === 'add-label' ? { kind: 'done' } : { kind: 'drop', reason: 'conflict' }
    }
    if (status === 400 || status === 422) return { kind: 'drop', reason: 'rejected' }
    // Too large for the server, and it will say so every time: a kept action would stop the replay
    // on the same 413 for ever and block everything behind it.
    if (status === 413) return { kind: 'drop', reason: actionType === 'upload-attachment' ? 'too-large' : 'rejected' }
    return { kind: 'stop', why: 'unknown' }
  }

  if (isRetriableError(failure.error)) return { kind: 'stop', why: 'network' }
  return { kind: 'stop', why: 'unknown' }
}
