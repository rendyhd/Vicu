import { isAuthError, isRetriableError, type FailureLike } from '../../shared/error-classify'
import type { OfflineActionType, OfflineFailureReason, OfflineReplayStop } from '../../shared/offline-queue-types'

const COLLAB_ACTIONS: ReadonlySet<OfflineActionType> = new Set<OfflineActionType>([
  'add-assignee',
  'remove-assignee',
  'create-comment',
  'update-comment',
  'delete-comment',
])

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

  // A web page from something in front of Vikunja (a sign-in proxy whose session ran out): Vikunja
  // never saw the request. Keep it and try again later, as when the server cannot be reached (C-1).
  if (failure.notApiResponse) return { kind: 'stop', why: 'network' }

  // An assignee or comment change answered 403 is about the project or the comment (the user lost
  // write access, or it is someone else's comment), not the session: one such change must not hold
  // up everything behind it (cross-app semantics 9.6). So is an API token without the permission for
  // it, which the API client turns from 401 into a 403 marked tokenPermission (9.7).
  if (status === 403 && COLLAB_ACTIONS.has(actionType)) {
    return { kind: 'drop', reason: failure.tokenPermission ? 'token-permission' : 'forbidden' }
  }
  // Any other 403 stops here as an auth problem; the replay then asks whether the session still
  // works (`refusedWhileSignedIn`) and, when it does, moves the change to the failed log (C-2).
  if (status === 401 || status === 403 || isAuthError(failure.error)) return { kind: 'stop', why: 'auth' }
  if (failure.error.includes('is not configured')) return { kind: 'stop', why: 'config' }

  if (status !== undefined) {
    // Vikunja 2.4 answers a merge patch that changes nothing with 304: the server already has it.
    if (status === 304) return { kind: 'done' }
    if (status === 429) return { kind: 'stop', why: 'rate-limit' }
    if (status === 408) return { kind: 'stop', why: 'network' }
    if (status >= 500) return { kind: 'stop', why: 'server' }

    if (status === 404) {
      // Deleting or detaching something that is already gone has the effect the user wanted.
      if (
        actionType === 'delete' ||
        actionType === 'remove-label' ||
        actionType === 'remove-assignee' ||
        actionType === 'remove-relation' ||
        actionType === 'delete-comment'
      ) {
        return { kind: 'done' }
      }
      return { kind: 'drop', reason: actionType === 'create' || actionType === 'update-comment' ? 'not-found' : 'task-gone' }
    }
    if (status === 409) {
      // The same label or relation is already there (Vikunja answers 409, code 4008 for a relation).
      return actionType === 'add-label' || actionType === 'add-relation' ? { kind: 'done' } : { kind: 'drop', reason: 'conflict' }
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

/**
 * A change answered 403 while the session itself still works: the user can read the project but no
 * longer change it (made read-only while the change waited). Only that change is refused, so it goes
 * to the failed log and the replay carries on (C-2). A 401, or a 403 while the session is gone,
 * still stops the replay as an auth problem.
 */
export function refusedWhileSignedIn(failure: FailureLike, connection: 'works' | 'refused' | 'unknown'): ReplayDecision | null {
  if (failure.statusCode !== 403 || failure.tokenPermission) return null
  if (connection === 'works') return { kind: 'drop', reason: 'no-write-access' }
  // No answer to the check: say nothing about the session, wait like any network problem.
  if (connection === 'unknown') return { kind: 'stop', why: 'network' }
  return null
}
