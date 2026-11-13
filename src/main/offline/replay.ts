import type { FailureLike } from '../../shared/error-classify'
import type {
  OfflineFailureReason,
  OfflineReplayEvent,
  OfflineReplayStop,
} from '../../shared/offline-queue-types'
import type { ApiResult } from '../api-result'
import { isQueueableFailure } from '../../shared/error-classify'
import { classifyReplayFailure, refusedWhileSignedIn, type ReplayDecision } from './classify'
import { planTaskUpdate } from './notes-save-step'
import { createFields, type OfflineQueue } from './queue'
import { hasTaskId, type QueuedAction } from './types'

/** The slice of the Vikunja client the replay needs. Tests pass fakes. */
export interface ReplayApi {
  createTask(projectId: number, payload: Record<string, unknown>): Promise<ApiResult<unknown>>
  updateTask(id: number, patch: Record<string, unknown>): Promise<ApiResult<unknown>>
  deleteTask(id: number): Promise<ApiResult<unknown>>
  addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<unknown>>
  removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<unknown>>
  fetchLabels(): Promise<ApiResult<unknown[]>>
  createLabel(label: Record<string, unknown>): Promise<ApiResult<unknown>>
  uploadTaskAttachment(taskId: number, bytes: Buffer, name: string, mime: string): Promise<ApiResult<unknown>>
  fetchTaskAttachments(taskId: number): Promise<ApiResult<unknown[]>>
  fetchTaskById(taskId: number): Promise<ApiResult<unknown>>
  /**
   * The task a create that may have been applied would have produced: same project and title,
   * created since `since`. Null when there is none.
   */
  findRecentCreate(projectId: number, fields: Record<string, unknown>, since: string): Promise<ApiResult<{ id: number } | null>>
  addTaskAssignee(taskId: number, userId: number): Promise<ApiResult<unknown>>
  createTaskRelation(taskId: number, otherTaskId: number, kind: string): Promise<ApiResult<unknown>>
  deleteTaskRelation(taskId: number, kind: string, otherTaskId: number): Promise<ApiResult<unknown>>
  removeTaskAssignee(taskId: number, userId: number): Promise<ApiResult<unknown>>
  createTaskComment(taskId: number, html: string): Promise<ApiResult<unknown>>
  updateTaskComment(taskId: number, commentId: number, html: string): Promise<ApiResult<unknown>>
  deleteTaskComment(taskId: number, commentId: number): Promise<ApiResult<unknown>>
  /**
   * The comment an unconfirmed create would have produced: same text, by the signed-in user,
   * created since `since`. Null when there is none.
   */
  findRecentComment(taskId: number, html: string, since: string): Promise<ApiResult<{ id: number } | null>>
  /**
   * Whether the saved session or token still works (one project read). Asked when a change is
   * answered 403: `works` means only that change was refused (C-2). Without it a 403 stops the replay.
   */
  connectionState?(): Promise<'works' | 'refused' | 'unknown'>
}

/** Replays that stop on the same action with an error that is neither network nor auth, before it is moved to the failed log. */
export const MAX_UNKNOWN_ATTEMPTS = 5

/** Same format as `imageToken` in src/renderer/lib/image-tokens.ts (the main process cannot import renderer code). */
const imageToken = (attachmentId: number): string => `[[image:${attachmentId}]]`

type Step =
  | {
      kind: 'ok'
      realId?: number
      /** An earlier, unconfirmed attempt had already created the task. */
      adopted?: boolean
      /** The task whose notes went out with both versions (another device changed them too). */
      notesMerged?: number
    }
  | { kind: 'failure'; failure: FailureLike }
  /** Removed from the queue while the replay was preparing its request: nothing was sent. */
  | { kind: 'cancelled' }
  /** Can never be sent (its task was never created, its image file is gone). */
  | { kind: 'broken'; reason: OfflineFailureReason; error: string }

const fail = (result: { error: string; statusCode?: number; tokenPermission?: boolean; notApiResponse?: boolean }): Step => ({
  kind: 'failure',
  failure: {
    error: result.error,
    statusCode: result.statusCode,
    ...(result.tokenPermission ? { tokenPermission: true } : {}),
    ...(result.notApiResponse ? { notApiResponse: true } : {}),
  },
})

/** `classifyReplayFailure`, plus the session check for a change answered 403 (C-2). */
async function decideFailure(api: ReplayApi, failure: FailureLike, actionType: QueuedAction['type']): Promise<ReplayDecision> {
  const decision = classifyReplayFailure(failure, actionType)
  if (decision.kind !== 'stop' || decision.why !== 'auth' || failure.statusCode !== 403 || !api.connectionState) return decision
  let connection: 'works' | 'refused' | 'unknown'
  try {
    connection = await api.connectionState()
  } catch {
    connection = 'unknown'
  }
  return refusedWhileSignedIn(failure, connection) ?? decision
}

/**
 * Replay the queue from the front, in order, against the server (D-SYNC-1, D-SYNC-4).
 *
 * The loop reads the live queue before every send instead of iterating a snapshot, so an action the
 * user removed or folded while an earlier one was in flight is never sent stale, and one that was
 * added meanwhile is picked up in the same run. The action being sent is marked in flight: changes
 * to it queue behind it, and an undo cannot pretend to cancel it.
 *
 * What a failure means is decided by `classifyReplayFailure`: only 400/404/409/413/422 move an action
 * to the failed log; auth problems, 5xx, 429 and network errors keep it and stop the run.
 */
export async function replayQueue(queue: OfflineQueue, api: ReplayApi): Promise<OfflineReplayEvent> {
  const idMap: Record<string, number> = {}
  const notesMerged: number[] = []
  const startFailed = queue.counts().failed
  let applied = 0
  let stopped: OfflineReplayStop | null = null
  let stopError: string | undefined

  queue.setReplaying(true)
  try {
    // Changes queued for another server or user never go out; they wait in the failed log to be
    // discarded. Checked up front and again per action, because the account can change mid-run.
    await queue.failForeign()
    for (let guard = 0; guard < 100_000; guard++) {
      const action = queue.nextAction()
      if (!action) break
      if (queue.isForeign(action)) {
        await queue.failForeign()
        continue
      }
      if (!queue.beginSend(action.id)) continue

      try {
        const step = await sendActionSafely(queue, api, action)

        if (step.kind === 'ok') {
          await queue.completeAction(action.id, { realId: step.realId, adopted: step.adopted })
          if (action.type === 'create' && step.realId !== undefined) idMap[String(action.tempId)] = step.realId
          if (step.notesMerged !== undefined && !notesMerged.includes(step.notesMerged)) notesMerged.push(step.notesMerged)
          applied++
          queue.setAuthProblem(null)
        } else if (step.kind === 'cancelled') {
          // Someone removed it; the queue already reflects that.
        } else if (step.kind === 'broken') {
          await queue.failAction(action.id, { error: step.error, reason: step.reason })
        } else {
          const decision = await decideFailure(api, step.failure, action.type)
          if (decision.kind === 'done') {
            await queue.completeAction(action.id)
            applied++
          } else if (decision.kind === 'drop') {
            console.warn(`[offline-queue] ${action.type} ${action.id} rejected: ${step.failure.error}`)
            await queue.failAction(action.id, { ...step.failure, reason: decision.reason })
          } else {
            if (decision.why === 'auth') queue.setAuthProblem(step.failure.error)
            // A create that timed out or hit a 500 may exist on the server already: remember that,
            // so the retry checks before it posts again.
            if (action.type === 'create' && decision.why !== 'auth' && !isQueueableFailure(step.failure, 'create')) {
              await queue.patchAction(action.id, { maybeSent: { projectId: action.projectId, fields: action.fields } })
            }
            // The same for a comment: the retry looks for it before posting it again.
            if (action.type === 'create-comment' && decision.why !== 'auth' && !isQueueableFailure(step.failure, 'create')) {
              await queue.patchAction(action.id, { maybeSent: true })
            }
            if (decision.why === 'unknown') {
              // Something the server said that we have no rule for. Keep the action for a few
              // replays, then surface it instead of blocking the queue for ever.
              const attempts = await queue.recordAttempt(action.id)
              if (attempts >= MAX_UNKNOWN_ATTEMPTS) {
                await queue.failAction(action.id, { ...step.failure, reason: 'gave-up' })
                continue
              }
            }
            stopped = decision.why
            stopError = step.failure.error
            break
          }
        }
      } catch (err) {
        // The queue could not be updated (a disk write failed). Stop rather than send more requests
        // whose results cannot be recorded; the next replay picks up from the saved state.
        stopped = 'unknown'
        stopError = err instanceof Error ? err.message : String(err)
        break
      } finally {
        queue.endSend()
      }
    }
  } finally {
    queue.setReplaying(false)
  }

  if (stopped === null) queue.setAuthProblem(null)

  return {
    applied,
    failed: Math.max(0, queue.counts().failed - startFailed),
    stopped,
    ...(stopError ? { error: stopError } : {}),
    idMap,
    counts: queue.counts(),
    ...(notesMerged.length > 0 ? { notesMerged } : {}),
  }
}

/** The real id a follow-up action should use: temp ids that were remapped but not yet rewritten resolve here. */
function targetTask(queue: OfflineQueue, action: Exclude<QueuedAction, { type: 'create' }>): number | null {
  if (action.taskId > 0) return action.taskId
  const real = queue.resolveTaskRef(action.taskId)
  return real !== null && real > 0 ? real : null
}

/** `sendAction`, with an exception from the API layer treated as a failure of the request instead of aborting the replay. */
async function sendActionSafely(queue: OfflineQueue, api: ReplayApi, action: QueuedAction): Promise<Step> {
  try {
    return await sendAction(queue, api, action)
  } catch (err) {
    return fail({ error: err instanceof Error ? err.message : String(err) })
  }
}

async function sendAction(queue: OfflineQueue, api: ReplayApi, action: QueuedAction): Promise<Step> {
  if (action.type === 'create') {
    let payload: Record<string, unknown>
    try {
      payload = createFields(action.fields)
    } catch (err) {
      return { kind: 'broken', reason: 'rejected', error: err instanceof Error ? err.message : 'The task is not valid' }
    }
    if (action.maybeSent) {
      // Look for what the unconfirmed attempt sent, which may differ from what the create holds now.
      const existing = await api.findRecentCreate(action.maybeSent.projectId, action.maybeSent.fields, action.createdAt)
      if (!existing.success) return fail(existing)
      if (existing.data) return { kind: 'ok', realId: existing.data.id, adopted: true }
    }
    const result = await api.createTask(action.projectId, payload)
    if (!result.success) return fail(result)
    const id = (result.data as { id?: unknown } | null)?.id
    return { kind: 'ok', realId: typeof id === 'number' && id > 0 ? id : undefined }
  }

  const taskId = hasTaskId(action) ? targetTask(queue, action) : null
  if (taskId === null) {
    return { kind: 'broken', reason: 'dependency-failed', error: 'The task this change belongs to was never created' }
  }

  switch (action.type) {
    case 'update': {
      // A queued completion of a repeating task goes out only while the server still holds the
      // occurrence it completed (cross-app semantics 7.5); a queued notes edit keeps both versions
      // when the server's notes changed since its base (description format, "Notes changed in two
      // places"). A read that fails on the network waits like the change.
      const plan = await planTaskUpdate(
        action.patch,
        {
          ...(action.completedDue !== undefined ? { completedDue: action.completedDue } : {}),
          ...(action.baseDescription !== undefined ? { baseDescription: action.baseDescription } : {}),
        },
        () => api.fetchTaskById(taskId)
      )
      if (plan.kind === 'failed') return fail(plan.failure)
      if (plan.kind === 'answer') return { kind: 'ok' }
      if (!queue.isQueued(action.id)) return { kind: 'cancelled' }
      const result = await api.updateTask(taskId, plan.patch)
      if (!result.success) return fail(result)
      return plan.notesMerged ? { kind: 'ok', notesMerged: taskId } : { kind: 'ok' }
    }
    case 'delete': {
      const result = await api.deleteTask(taskId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'remove-label': {
      const result = await api.removeLabelFromTask(taskId, action.labelId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'add-label': {
      let labelId = action.labelId
      if (labelId === undefined) {
        const resolved = await resolveLabel(queue, api, action.labelTitle ?? '')
        if ('step' in resolved) return resolved.step
        labelId = resolved.labelId
        await queue.patchAction(action.id, { labelId })
      }
      if (!queue.isQueued(action.id)) return { kind: 'cancelled' }
      const result = await api.addLabelToTask(taskId, labelId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'upload-attachment':
      return sendUpload(queue, api, action, taskId)
    case 'add-relation':
    case 'remove-relation': {
      // The other task was created offline and its create never made it: nothing to relate to.
      if (action.otherTaskId < 0) {
        return { kind: 'broken', reason: 'dependency-failed', error: 'The other task was never created' }
      }
      const result = action.type === 'add-relation'
        ? await api.createTaskRelation(taskId, action.otherTaskId, action.kind)
        : await api.deleteTaskRelation(taskId, action.kind, action.otherTaskId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'add-assignee': {
      const result = await api.addTaskAssignee(taskId, action.userId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'remove-assignee': {
      const result = await api.removeTaskAssignee(taskId, action.userId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
    case 'create-comment': {
      if (action.maybeSent) {
        const existing = await api.findRecentComment(taskId, action.comment, action.createdAt)
        if (!existing.success) return fail(existing)
        if (existing.data) return { kind: 'ok', realId: existing.data.id }
      }
      const result = await api.createTaskComment(taskId, action.comment)
      if (!result.success) return fail(result)
      const id = (result.data as { id?: unknown } | null)?.id
      return { kind: 'ok', realId: typeof id === 'number' && id > 0 ? id : undefined }
    }
    case 'update-comment':
    case 'delete-comment': {
      const commentId = queue.resolveCommentRef(action.commentId)
      if (commentId === null || commentId < 0) {
        return { kind: 'broken', reason: 'dependency-failed', error: 'The comment this change belongs to was never created' }
      }
      const result =
        action.type === 'update-comment'
          ? await api.updateTaskComment(taskId, commentId, action.comment)
          : await api.deleteTaskComment(taskId, commentId)
      return result.success ? { kind: 'ok' } : fail(result)
    }
  }
}

/** Find a label by title (case-insensitive), creating it when it does not exist yet. */
async function resolveLabel(
  queue: OfflineQueue,
  api: ReplayApi,
  title: string
): Promise<{ labelId: number } | { step: Step }> {
  const labels = await api.fetchLabels()
  if (!labels.success) return { step: fail(labels) }
  const wanted = title.trim().toLowerCase()
  const match = labels.data.find((l) => typeof (l as { title?: unknown }).title === 'string' && (l as { title: string }).title.trim().toLowerCase() === wanted) as
    | { id: number }
    | undefined
  if (match) return { labelId: match.id }

  const created = await api.createLabel({ title: title.trim() })
  if (!created.success) return { step: fail(created) }
  const id = (created.data as { id?: unknown } | null)?.id
  if (typeof id !== 'number') return { step: { kind: 'broken', reason: 'rejected', error: 'The server did not return the new label' } }
  return { labelId: id }
}

/**
 * Upload a queued image and, for Quick Entry images, append its `[[image:N]]` token to the task
 * description, as the online path does. The upload and the description edit are separate requests,
 * so progress is saved in between: a retry after the upload went through does not upload again.
 */
async function sendUpload(
  queue: OfflineQueue,
  api: ReplayApi,
  action: Extract<QueuedAction, { type: 'upload-attachment' }>,
  taskId: number
): Promise<Step> {
  if (!action.uploaded) {
    let bytes: Buffer
    try {
      bytes = await queue.files.read(action.file)
    } catch {
      return { kind: 'broken', reason: 'rejected', error: `The saved image "${action.name}" could not be read` }
    }
    // Reading took a moment; the user may have discarded the action meanwhile.
    if (!queue.isQueued(action.id)) return { kind: 'cancelled' }
    const uploaded = await api.uploadTaskAttachment(taskId, bytes, action.name, action.mime)
    if (!uploaded.success) return fail(uploaded)
    await queue.patchAction(action.id, { uploaded: true })
  }

  if (!action.addImageToken) return { kind: 'ok' }

  // The upload response does not reliably carry the attachment id, so ask for the list: the file
  // just uploaded has the highest id.
  const attachments = await api.fetchTaskAttachments(taskId)
  if (!attachments.success) return fail(attachments)
  const ids = attachments.data.map((a) => (a as { id?: unknown }).id).filter((id): id is number => typeof id === 'number')
  if (ids.length === 0) return { kind: 'ok' }
  const token = imageToken(Math.max(...ids))

  const task = await api.fetchTaskById(taskId)
  if (!task.success) return fail(task)
  const description = typeof (task.data as { description?: unknown } | null)?.description === 'string' ? (task.data as { description: string }).description : ''
  if (description.includes(token)) return { kind: 'ok' }

  const updated = await api.updateTask(taskId, { description: description ? `${description}\n${token}` : token })
  return updated.success ? { kind: 'ok' } : fail(updated)
}

/**
 * Single-flight wrapper: a second call while a replay runs joins it instead of starting another, so
 * no action can be in flight twice. Because the replay reads the live queue, anything queued while
 * it runs is sent by the same run.
 */
export function createReplayRunner(run: () => Promise<OfflineReplayEvent>): () => Promise<OfflineReplayEvent> {
  let current: Promise<OfflineReplayEvent> | null = null
  return () => {
    if (!current) {
      current = run().finally(() => {
        current = null
      })
    }
    return current
  }
}
