import { isUnreachableFailure } from '../../shared/error-classify'
import { decideNotesSave } from '../../shared/notes-merge'
import type { ApiError, ApiResult } from '../api-result'
import { planRepeatCompletion } from './repeat-completion-step'

// A task update, sent directly (the task write gate) or from the queue (the replay), that may need
// the task read first: the completion of a repeating task (cross-app semantics 7.5,
// repeat-completion-step.ts) and a notes edit that carries the description it started from
// (description format, "Notes changed in two places"). When both apply the task is read once. The
// notes decision itself is src/shared/notes-merge.ts; this is the part both senders share.

export type TaskUpdatePlan =
  /** Send `patch` (the original one, or what is left of it). `notesMerged`: its description holds both versions. */
  | { kind: 'send'; patch: Record<string, unknown>; notesMerged?: true }
  /** Nothing is left to send: the change counts as done, and `task` (the server's, as just read) is the answer. */
  | { kind: 'answer'; task: unknown; repeatSkipped?: true }
  /** The task could not be read and the change has to wait: the caller handles this like a failure of the change itself. */
  | { kind: 'failed'; failure: ApiError }

export interface TaskUpdateChecks {
  /** The due date a repeating task's completion completed (see `planRepeatCompletion`). */
  completedDue?: string | null
  /** The description the notes edit started from, as the server stored it. */
  baseDescription?: string
}

/** Whether a patch with these checks needs the task read before it is sent. */
export function needsRead(patch: Record<string, unknown>, checks: TaskUpdateChecks): boolean {
  return needsRepeatRead(patch, checks.completedDue) || needsNotesRead(patch, checks.baseDescription)
}

function needsRepeatRead(patch: Record<string, unknown>, completedDue: string | null | undefined): boolean {
  return completedDue !== undefined && patch.done === true && !('due_date' in patch)
}

function needsNotesRead(patch: Record<string, unknown>, baseDescription: string | undefined): boolean {
  return typeof baseDescription === 'string' && 'description' in patch
}

/** One read, however many steps ask for it. */
function readOnce(read: () => Promise<ApiResult<unknown>>): () => Promise<ApiResult<unknown>> {
  let pending: Promise<ApiResult<unknown>> | null = null
  return () => (pending ??= read())
}

const descriptionOf = (task: unknown): string | null => {
  const value = task && typeof task === 'object' ? (task as { description?: unknown }).description : undefined
  return typeof value === 'string' ? value : null
}

/**
 * What to send for `patch`. Without a check that applies, it is sent as it is and nothing is read.
 * A notes edit whose read fails because the server cannot be reached waits (`failed`); any other
 * failed read sends the edit as it is, and the send's own answer decides.
 */
export async function planTaskUpdate(
  patch: Record<string, unknown>,
  checks: TaskUpdateChecks,
  read: () => Promise<ApiResult<unknown>>
): Promise<TaskUpdatePlan> {
  const readTask = readOnce(read)

  const repeat = await planRepeatCompletion(patch, checks.completedDue, readTask)
  if (repeat.kind === 'failed') return { kind: 'failed', failure: repeat.failure }
  if (repeat.kind === 'skip') return { kind: 'answer', task: repeat.task, repeatSkipped: true }
  /** The completion was left out because another device completed that occurrence. */
  const repeatDropped = repeat.patch !== patch

  const current = repeat.patch
  if (!needsNotesRead(current, checks.baseDescription)) return { kind: 'send', patch: current }

  const task = await readTask()
  if (!task.success) {
    return isUnreachableFailure(task) ? { kind: 'failed', failure: task } : { kind: 'send', patch: current }
  }
  const local = current.description
  const decision = decideNotesSave(checks.baseDescription, typeof local === 'string' ? local : null, descriptionOf(task.data))
  if (decision.action === 'send') return { kind: 'send', patch: current }
  if (decision.action === 'merge') return { kind: 'send', patch: { ...current, description: decision.description }, notesMerged: true }

  const rest = { ...current }
  delete rest.description
  if (Object.keys(rest).length > 0) return { kind: 'send', patch: rest }
  return repeatDropped ? { kind: 'answer', task: task.data, repeatSkipped: true } : { kind: 'answer', task: task.data }
}
