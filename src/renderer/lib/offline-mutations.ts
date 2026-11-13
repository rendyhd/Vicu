import { api } from './api'
import { isQueueableFailure, maybeCreatedMessage } from './error-classify'
import { ApiError, apiError } from './mutation-errors'
import { isTempTaskId, pendingTaskFromCreate } from './pending-cache'
import { NOTES_MERGED_MESSAGE } from './notes-merged'
import { toast } from '@/stores/toast-store'
import type { TaskPatch } from './merge-patches'
import type { CreateTaskPayload, Label, Task } from './vikunja-types'
import type { OfflineImageInput, OfflineLabelRef, OfflineQueueResult, QueuedWriteReply } from '../../shared/offline-queue-types'

// The main window's writes (D-SYNC-6, decision 4): try the server; when it cannot be reached or is
// having trouble, the change goes into the main-process offline queue instead of failing, so the
// optimistic cache stays and the change is replayed later. Where a change to an existing task goes
// is decided in the main process (src/main/offline/task-writes.ts), in one place for every caller:
// it queues the change when the server cannot be reached and also when changes for that task are
// already waiting, because sending it around them would let the replay overwrite it later. A task
// that only exists as a pending create (negative temp id) never goes to the server: its changes go
// straight into the queue, where they fold into the create.
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

/** The main process queued the change instead of sending it. */
function isQueuedReply(result: { success: boolean }): result is QueuedWriteReply {
  return result.success && (result as Partial<QueuedWriteReply>).queued === true
}

export interface PatchOutcome {
  queued: boolean
  /** The server's task, or null when the change was queued. */
  task: Task | null
  /**
   * A repeating task's completion was not sent: another device had completed that occurrence
   * already, and `task` is the server's task as it is (cross-app semantics 7.5).
   */
  repeatSkipped?: boolean
  /**
   * The notes were also changed on another device since the edit's base: both versions were sent,
   * `task` is the server's task with them, and the user has been told (description format, "Notes
   * changed in two places").
   */
  notesMerged?: boolean
}

/** Tell the user that a notes edit kept another device's change too. */
export function sayNotesMerged(): void {
  toast.info(NOTES_MERGED_MESSAGE)
}

/** Send a minimal task patch, or queue it. */
export async function sendTaskPatch(
  id: number,
  patch: TaskPatch,
  title?: string,
  /**
   * `completedDue`: with `{ done: true }` of a task held as repeating, the due date it completed
   * (cross-app semantics 7.5). `baseDescription`: with a patch that holds `description`, the
   * description the edit started from, as the server stored it (description format, "Notes
   * changed in two places"); leave it out when the writer never read the notes.
   */
  options: { completedDue?: string | null; baseDescription?: string } = {},
): Promise<PatchOutcome> {
  if (isTempTaskId(id)) {
    // A pending create is not on the server: no other device can have completed it or changed its notes.
    await queueChange(() => api.offlineQueue.enqueueUpdate(id, patch, titleMeta(title)))
    return { queued: true, task: null }
  }
  const extra = {
    ...(options.completedDue !== undefined ? { completedDue: options.completedDue } : {}),
    ...(options.baseDescription !== undefined && 'description' in patch ? { baseDescription: options.baseDescription } : {}),
  }
  const result = await api.updateTaskOrQueue(id, patch, title, extra)
  if (!result.success) throw apiError(result)
  if (isQueuedReply(result)) return { queued: true, task: null }
  if ((result as { repeatSkipped?: unknown }).repeatSkipped === true) return { queued: false, task: result.data, repeatSkipped: true }
  if ((result as { notesMerged?: unknown }).notesMerged === true) {
    sayNotesMerged()
    return { queued: false, task: result.data, notesMerged: true }
  }
  return { queued: false, task: result.data }
}

/** Delete a task, or queue the delete. Deleting a pending create just removes it from the queue. */
export async function deleteTaskOrQueue(id: number, title?: string): Promise<{ queued: boolean }> {
  if (isTempTaskId(id)) {
    await queueChange(() => api.offlineQueue.enqueueDelete(id, titleMeta(title)))
    return { queued: true }
  }
  const result = await api.deleteTaskOrQueue(id, title)
  if (!result.success) throw apiError(result)
  return { queued: isQueuedReply(result) }
}

export async function addLabelOrQueue(
  taskId: number,
  label: { id: number; title?: string },
  taskTitle?: string,
): Promise<{ queued: boolean }> {
  if (isTempTaskId(taskId)) {
    const ref: OfflineLabelRef = label.title ? { id: label.id, title: label.title } : { id: label.id }
    await queueChange(() => api.offlineQueue.enqueueAddLabel(taskId, ref, titleMeta(taskTitle)))
    return { queued: true }
  }
  const result = await api.addLabelToTaskOrQueue(taskId, label, taskTitle)
  if (!result.success) throw apiError(result)
  return { queued: isQueuedReply(result) }
}

export async function removeLabelOrQueue(taskId: number, labelId: number, taskTitle?: string): Promise<{ queued: boolean }> {
  if (isTempTaskId(taskId)) {
    await queueChange(() => api.offlineQueue.enqueueRemoveLabel(taskId, labelId, titleMeta(taskTitle)))
    return { queued: true }
  }
  const result = await api.removeLabelFromTaskOrQueue(taskId, labelId, taskTitle)
  if (!result.success) throw apiError(result)
  return { queued: isQueuedReply(result) }
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
  if (!isQueueableFailure(result, 'create')) {
    // A timeout or a 500 may have created the task; say so, so "try again" does not add it twice.
    const warning = maybeCreatedMessage(result)
    throw apiError(warning ? { ...result, error: warning, mayExist: true } : result)
  }

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
