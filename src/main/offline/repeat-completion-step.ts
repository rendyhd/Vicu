import { decideRepeatCompletion, type RepeatCompletionTask } from '../../shared/repeat-completion'
import type { ApiError, ApiResult } from '../api-result'

// The completion of a repeating task, sent directly (the task write gate) or from the queue (the
// replay): read the task first and send the completion only when the server still holds the
// occurrence the user completed (docs/cross-app-semantics-v1.md section 7.5). The decision itself is
// src/shared/repeat-completion.ts; this is the part both senders share.

export type RepeatCompletionPlan =
  /** Send `patch` (the original one, or what is left of it when only the completion is skipped). */
  | { kind: 'send'; patch: Record<string, unknown> }
  /** Another device completed this occurrence already: send nothing, the change counts as done. `task` is the server's. */
  | { kind: 'skip'; task: unknown }
  /** The task could not be read: the caller handles this like a failure of the change itself. */
  | { kind: 'failed'; failure: ApiError }

/**
 * What to send for `patch`. Without a completed due (`undefined`: the app held the task as not
 * repeating, or a queued completion of an older version) or when the patch does not complete, it is
 * sent as it is without a read. A patch that also sets `due_date` is sent as it is too: Vikunja moves
 * the task on from the date in the patch, which is what the user asked for. On skip, the other
 * fields of the patch (an edit made together with the completion) are still sent.
 */
export async function planRepeatCompletion(
  patch: Record<string, unknown>,
  completedDue: string | null | undefined,
  read: () => Promise<ApiResult<unknown>>
): Promise<RepeatCompletionPlan> {
  if (completedDue === undefined || patch.done !== true || 'due_date' in patch) return { kind: 'send', patch }
  const current = await read()
  if (!current.success) return { kind: 'failed', failure: current }
  const server = (current.data && typeof current.data === 'object' ? current.data : {}) as RepeatCompletionTask
  if (decideRepeatCompletion(completedDue, server) === 'send') return { kind: 'send', patch }
  const rest = { ...patch }
  delete rest.done
  return Object.keys(rest).length > 0 ? { kind: 'send', patch: rest } : { kind: 'skip', task: current.data }
}
