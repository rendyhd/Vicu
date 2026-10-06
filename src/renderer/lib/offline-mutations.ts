import { api } from './api'
import { isQueueableFailure } from './error-classify'
import { ApiError, apiError } from './mutation-errors'
import { isTempTaskId, pendingTaskFromCreate } from './pending-cache'
import type { TaskPatch } from './merge-patches'
import type { CreateTaskPayload, Label, Task } from './vikunja-types'
import type { OfflineImageInput, OfflineLabelRef, OfflineQueueResult } from '../../shared/offline-queue-types'

// The main window's writes (D-SYNC-6, decision 4): try the server; when it cannot be reached or is
// having trouble, hand the change to the main-process offline queue instead of failing, so the
// optimistic cache stays and the change is replayed later. A task that only exists as a pending
// create (negative temp id) never goes to the server: its changes go straight into the queue,
// where they fold into the create.
//
// A change the server looked at and refused (4xx) or an auth problem is not queued: it throws an
// `ApiError`, the hook rolls the cache back and the global handler tells the user why.

interface Failure {
  error: string
  statusCode?: number
}

/** Hand a change to the queue; an unusable queue turns into the error the user sees. */
async function queueChange<T>(enqueue: () => Promise<OfflineQueueResult<T>>, original?: Failure): Promise<T> {
  let result: OfflineQueueResult<T>
  try {
    result = await enqueue()
  } catch (err) {
    throw new ApiError(`Could not save offline: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!result.success) {
    // Keep the status the server gave, so the toast still describes the original problem.
    throw new ApiError(`Could not save offline: ${result.error}`, original?.statusCode)
  }
  return result.data
}

const titleMeta = (title?: string): { title?: string } => (title ? { title } : {})

export interface PatchOutcome {
  queued: boolean
  /** The server's task, or null when the change was queued. */
  task: Task | null
}

/** Send a minimal task patch, or queue it. */
export async function sendTaskPatch(id: number, patch: TaskPatch, title?: string): Promise<PatchOutcome> {
  if (isTempTaskId(id)) {
    await queueChange(() => api.offlineQueue.enqueueUpdate(id, patch, titleMeta(title)))
    return { queued: true, task: null }
  }
  const result = await api.updateTask(id, patch)
  if (result.success) return { queued: false, task: result.data }
  if (!isQueueableFailure(result, 'change')) throw apiError(result)
  await queueChange(() => api.offlineQueue.enqueueUpdate(id, patch, titleMeta(title)), result)
  return { queued: true, task: null }
}

/** Delete a task, or queue the delete. Deleting a pending create just removes it from the queue. */
export async function deleteTaskOrQueue(id: number, title?: string): Promise<{ queued: boolean }> {
  if (isTempTaskId(id)) {
    await queueChange(() => api.offlineQueue.enqueueDelete(id, titleMeta(title)))
    return { queued: true }
  }
  const result = await api.deleteTask(id)
  if (result.success) return { queued: false }
  if (!isQueueableFailure(result, 'change')) throw apiError(result)
  await queueChange(() => api.offlineQueue.enqueueDelete(id, titleMeta(title)), result)
  return { queued: true }
}

export async function addLabelOrQueue(
  taskId: number,
  label: { id: number; title?: string },
  taskTitle?: string,
): Promise<{ queued: boolean }> {
  const ref: OfflineLabelRef = label.title ? { id: label.id, title: label.title } : { id: label.id }
  if (isTempTaskId(taskId)) {
    await queueChange(() => api.offlineQueue.enqueueAddLabel(taskId, ref, titleMeta(taskTitle)))
    return { queued: true }
  }
  const result = await api.addLabelToTask(taskId, label.id)
  if (result.success) return { queued: false }
  if (!isQueueableFailure(result, 'change')) throw apiError(result)
  await queueChange(() => api.offlineQueue.enqueueAddLabel(taskId, ref, titleMeta(taskTitle)), result)
  return { queued: true }
}

export async function removeLabelOrQueue(taskId: number, labelId: number, taskTitle?: string): Promise<{ queued: boolean }> {
  if (isTempTaskId(taskId)) {
    await queueChange(() => api.offlineQueue.enqueueRemoveLabel(taskId, labelId, titleMeta(taskTitle)))
    return { queued: true }
  }
  const result = await api.removeLabelFromTask(taskId, labelId)
  if (result.success) return { queued: false }
  if (!isQueueableFailure(result, 'change')) throw apiError(result)
  await queueChange(() => api.offlineQueue.enqueueRemoveLabel(taskId, labelId, titleMeta(taskTitle)), result)
  return { queued: true }
}

export interface CreateExtras {
  /** Labels and pasted images the queue keeps with the create and applies after it replays. */
  labels?: OfflineLabelRef[]
  images?: OfflineImageInput[]
  /** Label objects to show on the pending task (the queue only needs `labels`). */
  displayLabels?: Label[]
  /** The description to queue instead of the one that was sent (placeholders for pasted images removed). */
  queuedDescription?: string
}

export interface CreateOutcome {
  queued: boolean
  /** The server's task, or a stand-in carrying the temp id when the create was queued. */
  task: Task
}

/**
 * Create a task, or queue the create. A create is queued only when the request provably created
 * nothing (see `isQueueableFailure`): a timeout or a 500 may have been applied, and replaying it
 * would add a duplicate, so those are reported instead.
 */
export async function createTaskOrQueue(
  projectId: number,
  task: CreateTaskPayload,
  extras: CreateExtras = {},
): Promise<CreateOutcome> {
  const result = await api.createTask(projectId, task)
  if (result.success) return { queued: false, task: result.data }
  if (!isQueueableFailure(result, 'create')) throw apiError(result)

  const { done, labels: _labels, ...rest } = task
  const fields: Record<string, unknown> = { ...rest }
  if (extras.queuedDescription !== undefined) {
    if (extras.queuedDescription.trim()) fields.description = extras.queuedDescription
    else delete fields.description
  }
  const created = await queueChange(
    () =>
      api.offlineQueue.enqueueCreate({
        projectId,
        fields,
        done: done === true,
        labels: extras.labels,
        images: extras.images,
      }),
    result,
  )
  return {
    queued: true,
    task: pendingTaskFromCreate(created.tempId, projectId, fields, { done: done === true, labels: extras.displayLabels }),
  }
}
