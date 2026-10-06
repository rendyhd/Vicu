import { isQueueableFailure } from '../../shared/error-classify'
import type { ApiResult } from '../api-result'
import type { OfflineQueue } from './queue'
import { parseQueuedImages, parseQueuedLabels } from './parse-input'

// What Quick Entry and Quick View do when the server cannot be reached. The IPC handlers in
// ipc-handlers.ts stay thin (standalone mode, argument shapes, window notifications) and call into
// here, so the queueing rules can be tested with a fake API and a real queue in a temp folder.

/** The part of the Vikunja client these actions use. */
export interface QuickActionApi {
  createTask(projectId: number, payload: Record<string, unknown>): Promise<ApiResult<unknown>>
  updateTask(id: number, patch: Record<string, unknown>): Promise<ApiResult<unknown>>
}

export interface QuickActionDeps {
  queue: OfflineQueue
  api: QuickActionApi
  /** Tell the main window its task lists are stale. */
  notifyMainWindow: () => void
}

/** Quick View stores the subtasks it completed along with a task under this key, to undo them together. */
export const AUTO_COMPLETED_SUBTASKS_KEY = '__vicu_auto_completed_subtasks'

/** An API result, or the success of a change that is waiting in the queue instead (`cached`). */
export type QuickActionResult =
  | ApiResult<unknown>
  | { success: true; cached?: boolean; cancelledPending?: boolean; pendingId?: string }

// --- Quick Entry -------------------------------------------------------------------------

/**
 * Create a task from Quick Entry. When the request provably never created anything, the create is
 * queued with everything the user set: every field, labels, and pasted images (D-SYNC-3, D-QE-1).
 * A failure that may have been applied (timeout, 500) is reported instead of queued, because
 * replaying it could add a duplicate.
 */
export async function createFromQuickEntry(
  deps: QuickActionDeps,
  projectId: number,
  payload: Record<string, unknown>,
  extras?: { labels?: unknown; images?: unknown }
): Promise<QuickActionResult> {
  const result = await deps.api.createTask(projectId, payload)
  if (result.success) {
    deps.notifyMainWindow()
    return result
  }
  if (!isQueueableFailure(result, 'create')) return result

  try {
    const queued = await deps.queue.enqueueCreate({
      projectId,
      fields: payload,
      labels: parseQueuedLabels(extras?.labels),
      images: parseQueuedImages(extras?.images),
    })
    return { success: true, cached: true, pendingId: queued.pendingId }
  } catch (err) {
    return { success: false, error: `Could not save offline: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** What `queueQuickEntryFollowUps` queued, or why it could not. */
export type FollowUpResult = { success: true; labels: number; images: number } | { success: false; error: string }

/**
 * Queue the label and image follow-ups of a Quick Entry create that did reach the server but whose
 * label or upload call then could not (the network dropped in between). The window sends only what
 * failed with a queueable error, so nothing is queued twice. Labels may be named by title; the
 * replay looks them up or creates them.
 */
export async function queueQuickEntryFollowUps(
  queue: OfflineQueue,
  taskId: number,
  extras: { labels?: unknown; images?: unknown },
  title?: string
): Promise<FollowUpResult> {
  if (!Number.isInteger(taskId) || taskId <= 0) return { success: false, error: 'Invalid task' }
  const meta = title ? { title } : {}
  let labels = 0
  let images = 0
  const seen = new Set<string>()
  try {
    for (const label of parseQueuedLabels(extras.labels)) {
      const key = label.id !== undefined ? `id:${label.id}` : `title:${(label.title ?? '').toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      await queue.enqueueAddLabel(taskId, label, meta)
      labels++
    }
    for (const image of parseQueuedImages(extras.images)) {
      // Pasted images get their `[[image:N]]` token appended on replay, as the online path does.
      await queue.enqueueUpload(taskId, image, { addImageToken: image.inline !== false, ...meta })
      images++
    }
  } catch (err) {
    return { success: false, error: `Could not save offline: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { success: true, labels, images }
}

// --- Quick View --------------------------------------------------------------------------

// A Quick View row is a task on the server, or (offline) a `pending_<id>` placeholder for a task
// whose create is still queued. Changes to a placeholder fold into that create instead of being
// sent anywhere; a placeholder whose create already replayed resolves to the real id (D-SYNC-4).
type Target = { kind: 'server'; id: number } | { kind: 'queued'; ref: number } | { kind: 'unknown' }

function targetOf(queue: OfflineQueue, taskId: number | string): Target {
  const resolved = queue.resolveTaskRef(taskId)
  if (resolved === null) return { kind: 'unknown' }
  return resolved < 0 ? { kind: 'queued', ref: resolved } : { kind: 'server', id: resolved }
}

const STALE_QUEUED_TASK: QuickActionResult = {
  success: false,
  error: 'This task is no longer waiting to sync. Refresh the list.',
}

function titleMeta(task: Record<string, unknown> | undefined): { title?: string } {
  return typeof task?.title === 'string' && task.title ? { title: task.title } : {}
}

/** Every unfinished subtask below `task`, following `related_tasks.subtask`. */
export function taskDescendants(task: Record<string, unknown>): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  const rootId = typeof task.id === 'number' ? task.id : null
  const visited = new Set<number>(rootId === null ? [] : [rootId])

  const visit = (parent: Record<string, unknown>) => {
    const related = parent.related_tasks
    if (!related || typeof related !== 'object') return
    const children = (related as { subtask?: unknown }).subtask
    if (!Array.isArray(children)) return
    for (const value of children) {
      if (!value || typeof value !== 'object') continue
      const child = value as Record<string, unknown>
      if (typeof child.id !== 'number' || visited.has(child.id)) continue
      visited.add(child.id)
      result.push(child)
      visit(child)
    }
  }

  visit(task)
  return result
}

function withoutCompletionMetadata(task: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...task }
  delete clean[AUTO_COMPLETED_SUBTASKS_KEY]
  return clean
}

/** Send a merge patch for a Quick View row, queueing it when the server cannot be reached. */
export async function quickViewPatch(
  deps: QuickActionDeps,
  rawTaskId: number | string,
  patch: Record<string, unknown>,
  taskData?: Record<string, unknown>
): Promise<QuickActionResult> {
  const target = targetOf(deps.queue, rawTaskId)
  if (target.kind === 'unknown') return STALE_QUEUED_TASK
  const meta = titleMeta(taskData ?? patch)
  if (target.kind === 'queued') {
    await deps.queue.enqueueUpdate(target.ref, patch, meta)
    return { success: true, cached: true }
  }

  const result = await deps.api.updateTask(target.id, patch)
  if (result.success) {
    deps.notifyMainWindow()
    return result
  }
  if (isQueueableFailure(result, 'change')) {
    await deps.queue.enqueueUpdate(target.id, patch, meta)
    return { success: true, cached: true }
  }
  return result
}

/**
 * Complete a task and its unfinished subtasks. Anything the server cannot take is queued as
 * `{ done: true }`; if one step is refused for a real reason, the steps already taken are undone.
 */
export async function quickViewComplete(
  deps: QuickActionDeps,
  rawTaskId: number | string,
  taskData: Record<string, unknown>
): Promise<QuickActionResult> {
  const { queue, api } = deps
  const target = targetOf(queue, rawTaskId)
  if (target.kind === 'unknown') return STALE_QUEUED_TASK
  if (target.kind === 'queued') {
    // A task that only exists in the queue becomes a create with `done` set.
    await queue.enqueueComplete(target.ref, true, titleMeta(taskData))
    return { success: true, cached: true }
  }

  const taskId = target.id
  const cleanTask = withoutCompletionMetadata(taskData)
  const autoCompleted = taskDescendants(cleanTask).filter((task) => task.done !== true)
  const changed: Array<{ task: Record<string, unknown>; queued: boolean }> = []
  const undoChanged = async () => {
    for (const entry of changed.reverse()) {
      const id = entry.task.id as number
      // A completion that is still queued is taken back out; one that reached the server is reopened.
      if (entry.queued && (await queue.cancelChange(id, ['done']))) continue
      await api.updateTask(id, { done: false })
    }
  }

  for (const child of [...autoCompleted].reverse()) {
    const childId = child.id as number
    const result = await api.updateTask(childId, { done: true })
    if (result.success) {
      changed.push({ task: child, queued: false })
    } else if (isQueueableFailure(result, 'change')) {
      await queue.enqueueComplete(childId, true, titleMeta(child))
      changed.push({ task: child, queued: true })
    } else {
      await undoChanged()
      return result
    }
  }

  const result = await api.updateTask(taskId, { done: true })
  if (!result.success && !isQueueableFailure(result, 'change')) {
    await undoChanged()
    return result
  }
  if (!result.success) {
    await queue.enqueueComplete(taskId, true, titleMeta(cleanTask))
  }
  deps.notifyMainWindow()
  return result.success ? result : { success: true, cached: true }
}

/**
 * Undo a completion. A completion still waiting in the queue is taken back out, so the server never
 * hears about it. One that is being sent right now cannot be (D-SYNC-4): the reopen is queued
 * behind it.
 */
export async function quickViewReopen(
  deps: QuickActionDeps,
  rawTaskId: number | string,
  taskData: Record<string, unknown>
): Promise<QuickActionResult> {
  const { queue, api } = deps
  const autoCompleted = Array.isArray(taskData[AUTO_COMPLETED_SUBTASKS_KEY])
    ? (taskData[AUTO_COMPLETED_SUBTASKS_KEY] as Record<string, unknown>[])
    : []
  const cleanTask = withoutCompletionMetadata(taskData)
  let usedCache = false
  let cancelledPending = false

  const restore = async (ref: number | string, task: Record<string, unknown>): Promise<QuickActionResult> => {
    if (await queue.cancelChange(ref, ['done'])) {
      cancelledPending = true
      return { success: true }
    }
    const target = targetOf(queue, ref)
    if (target.kind === 'unknown') return STALE_QUEUED_TASK
    if (target.kind === 'queued') {
      await queue.enqueueComplete(target.ref, false, titleMeta(task))
      usedCache = true
      return { success: true }
    }
    const result = await api.updateTask(target.id, { done: false })
    if (!result.success && isQueueableFailure(result, 'change')) {
      await queue.enqueueComplete(target.id, false, titleMeta(task))
      usedCache = true
      return { success: true }
    }
    return result
  }

  const rootResult = await restore(rawTaskId, cleanTask)
  if (!rootResult.success) return rootResult
  for (const child of [...autoCompleted].reverse()) {
    if (typeof child.id !== 'number') continue
    const childResult = await restore(child.id, child)
    if (!childResult.success) return childResult
  }

  deps.notifyMainWindow()
  return {
    success: true,
    cached: usedCache || undefined,
    cancelledPending: cancelledPending || undefined,
  }
}
