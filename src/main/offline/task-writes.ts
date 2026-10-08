import { isQueueableFailure } from '../../shared/error-classify'
import type { QueuedWriteReply, TaskWriteOptions } from '../../shared/offline-queue-types'
import type { ApiError, ApiResult, ApiSuccess } from '../api-result'
import type { OfflineQueue } from './queue'

// The one place where a change to an existing task decides between "send it now" and "queue it".
//
// The queue replays in order and a replay sends each action's patch as it was written. If a newer
// change were sent straight to the server while an older one for the same task still waits in the
// queue, the replay would later send the older one on top of it and the user's last edit would be
// lost (the title ends up as EDIT1 although EDIT2 was typed last). So:
//
//   - while the queue holds anything for a task, a new change to that task goes into the queue as
//     well, where it folds into what is there (the newest value of a field wins);
//   - changes to one task are handled one at a time, so a request that is still in flight cannot be
//     overtaken by the next change and then queued behind it after it fails;
//   - a change that could not reach the server is queued here, not by the caller, so nothing can
//     slip in between the failure and the enqueue.
//
// Every IPC handler and Quick View action that changes an existing task goes through `writeTask`.
// The replay itself talks to the Vikunja client directly: it is the queue's own sender.

/** One change to one existing task: how to send it, and how to put it in the queue. */
export interface TaskWriteSpec {
  taskId: number
  send(): Promise<ApiResult<unknown>>
  enqueue(): Promise<unknown>
}

export type TaskWriteOutcome =
  /** The server took the change. */
  | { kind: 'sent'; result: ApiSuccess<unknown> }
  /**
   * The change is in the queue. `behind-queue`: the task already had changes waiting; `unreachable`:
   * the server could not be reached or is having trouble.
   */
  | { kind: 'queued'; reason: 'behind-queue' | 'unreachable' }
  /** Nothing was sent or queued; `result` says why (the server refused it, or the caller cannot queue). */
  | { kind: 'refused'; result: ApiError }

/** Said to a caller that cannot queue (it needs the server's answer) when changes are still waiting for the task. */
export const WAITING_TO_SYNC_ERROR =
  'This task has changes waiting to sync, so it was not changed on the server. Try again once they have synced.'

export interface TaskWriteDeps {
  queue: OfflineQueue
  /** Ask for a replay soon: the server just answered, or a change joined a queue that is waiting. */
  requestReplay?: () => void
}

const titleMeta = (title?: string): { title?: string } => (title ? { title } : {})

/** Specs for the four writes the app makes to an existing task. */
export const taskWrites = {
  update(
    queue: OfflineQueue,
    api: { updateTask(id: number, patch: Record<string, unknown>): Promise<ApiResult<unknown>> },
    taskId: number,
    patch: Record<string, unknown>,
    title?: string
  ): TaskWriteSpec {
    return {
      taskId,
      send: () => api.updateTask(taskId, patch),
      enqueue: () => queue.enqueueUpdate(taskId, patch, titleMeta(title)),
    }
  },
  delete(
    queue: OfflineQueue,
    api: { deleteTask(id: number): Promise<ApiResult<unknown>> },
    taskId: number,
    title?: string
  ): TaskWriteSpec {
    return {
      taskId,
      send: () => api.deleteTask(taskId),
      enqueue: () => queue.enqueueDelete(taskId, titleMeta(title)),
    }
  },
  addLabel(
    queue: OfflineQueue,
    api: { addLabelToTask(taskId: number, labelId: number): Promise<ApiResult<unknown>> },
    taskId: number,
    label: { id: number; title?: string },
    title?: string
  ): TaskWriteSpec {
    return {
      taskId,
      send: () => api.addLabelToTask(taskId, label.id),
      enqueue: () => queue.enqueueAddLabel(taskId, label.title ? { id: label.id, title: label.title } : { id: label.id }, titleMeta(title)),
    }
  },
  removeLabel(
    queue: OfflineQueue,
    api: { removeLabelFromTask(taskId: number, labelId: number): Promise<ApiResult<unknown>> },
    taskId: number,
    labelId: number,
    title?: string
  ): TaskWriteSpec {
    return {
      taskId,
      send: () => api.removeLabelFromTask(taskId, labelId),
      enqueue: () => queue.enqueueRemoveLabel(taskId, labelId, titleMeta(title)),
    }
  },
}

// Requests that change tasks leave one at a time, whatever task they are for. Vikunja's default
// database is SQLite, which answers parallel writes with "database is locked" (a 500). A bulk change
// from the selection bar or the context menu used to send one request per task at once and lost
// some of them to the offline queue. The renderer still updates its caches optimistically; only the
// requests wait for each other.
let sending = false
const sendWaiting: Array<() => void> = []

/** Run a request after every earlier one has finished (successfully or not). It starts at once when none is running. */
export async function sendSerially<T>(send: () => Promise<T>): Promise<T> {
  if (sending) await new Promise<void>((resolve) => sendWaiting.push(resolve))
  else sending = true
  try {
    return await send()
  } finally {
    const next = sendWaiting.shift()
    if (next) next()
    else sending = false
  }
}

// One chain of pending writes per task and queue. Entries remove themselves when the chain drains.
const chains = new WeakMap<OfflineQueue, Map<number, Promise<void>>>()

function runInOrder<T>(queue: OfflineQueue, taskId: number, step: () => Promise<T>): Promise<T> {
  let byTask = chains.get(queue)
  if (!byTask) {
    byTask = new Map()
    chains.set(queue, byTask)
  }
  const tasks = byTask
  const run = (tasks.get(taskId) ?? Promise.resolve()).then(step)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  tasks.set(taskId, tail)
  void tail.then(() => {
    if (tasks.get(taskId) === tail) tasks.delete(taskId)
  })
  return run
}

const saveFailed = (error: unknown, statusCode?: number): ApiError => ({
  success: false,
  error: `Could not save offline: ${error instanceof Error ? error.message : String(error)}`,
  ...(statusCode !== undefined ? { statusCode } : {}),
})

/**
 * Make one change to an existing task. `options.queue` says whether the caller can live with the
 * change being queued: true for the main window's edits and Quick View, false for a caller that
 * needs the server's answer (it then gets a refusal instead of a queued change).
 */
export function writeTask(deps: TaskWriteDeps, spec: TaskWriteSpec, options: Pick<TaskWriteOptions, 'queue'> = {}): Promise<TaskWriteOutcome> {
  const { queue } = deps
  const canQueue = options.queue === true

  const enqueue = async (reason: 'behind-queue' | 'unreachable', original?: { statusCode?: number }): Promise<TaskWriteOutcome> => {
    try {
      await spec.enqueue()
    } catch (err) {
      return { kind: 'refused', result: saveFailed(err, original?.statusCode) }
    }
    if (reason === 'behind-queue') deps.requestReplay?.()
    return { kind: 'queued', reason }
  }

  return runInOrder(queue, spec.taskId, async (): Promise<TaskWriteOutcome> => {
    if (queue.hasPendingFor(spec.taskId)) {
      if (!canQueue) return { kind: 'refused', result: { success: false, error: WAITING_TO_SYNC_ERROR } }
      return enqueue('behind-queue')
    }

    let result: ApiResult<unknown>
    try {
      result = await sendSerially(spec.send)
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (result.success) {
      // The server answered: a good moment to send what is waiting for other tasks.
      if (queue.counts().pending > 0) deps.requestReplay?.()
      return { kind: 'sent', result }
    }
    if (canQueue && isQueueableFailure(result, 'change')) return enqueue('unreachable', result)
    return { kind: 'refused', result }
  })
}

/** What a queue-aware IPC call answers: the server's result, the queued marker, or the refusal. */
export function taskWriteReply(outcome: TaskWriteOutcome): ApiResult<unknown> | QueuedWriteReply {
  if (outcome.kind === 'sent') return outcome.result
  if (outcome.kind === 'queued') return { success: true, queued: true, data: null }
  return outcome.result
}

/** Read the optional trailing argument of a task write call; anything else means "cannot queue". */
export function parseTaskWriteOptions(value: unknown): TaskWriteOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const options: TaskWriteOptions = {}
  if (raw.queue === true) options.queue = true
  if (typeof raw.title === 'string' && raw.title) options.title = raw.title
  if (typeof raw.labelTitle === 'string' && raw.labelTitle) options.labelTitle = raw.labelTitle
  return options
}
