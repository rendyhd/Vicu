/**
 * Types of the main-process offline queue (src/main/offline/) that cross the IPC boundary, so the
 * renderer can show pending and failed changes. Type-only and import-free so any tsconfig can
 * include it.
 *
 * Vocabulary:
 * - A *pending* action is a change the server has not accepted yet. They replay in order.
 * - A *failed* action was rejected for good (400/404/409/413/422 or too many unknown errors). It stays
 *   in a visible log with the error until the user retries or discards it.
 * - A *temp id* is the negative number a task created offline carries until its create replays.
 *   Quick View rows use the string form `pending_<actionId>`; both name the same task.
 */

/** A real task id, a negative temp id, or `pending_<actionId>`. */
export type OfflineTaskRef = number | string

export type OfflineActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'add-label'
  | 'remove-label'
  | 'upload-attachment'

export type OfflineFailureReason =
  | 'rejected' // 400 / 413 / 422: the server refused the data
  | 'too-large' // 413 on an upload: the file is over the server's size limit
  | 'conflict' // 409
  | 'task-gone' // 404 on a change to a task that no longer exists
  | 'not-found' // 404 on something else (a project, a label)
  | 'dependency-failed' // the task this action belongs to was never created
  | 'gave-up' // unknown errors on several replays in a row
  | 'other-account' // queued for a different server or user than the one signed in now

/** Why a replay stopped before the queue was empty. `null` means it finished. */
export type OfflineReplayStop = 'auth' | 'network' | 'server' | 'rate-limit' | 'config' | 'unknown'

/** The writable fields a queued create carries, a merge-patch shaped object. */
export type OfflineTaskFields = Record<string, unknown>

export interface OfflineLabelRef {
  /** The label's id when it is known. */
  id?: number
  /** Used when the label may not exist yet: it is looked up (or created) by title on replay. */
  title?: string
}

export interface OfflineImageInput {
  name: string
  mime: string
  bytes: Uint8Array
  /**
   * A pasted image whose `[[image:N]]` token is added to the description once uploaded (the
   * default). False for a plain file attachment, which only gets uploaded.
   */
  inline?: boolean
}

export interface OfflineCreateInput {
  projectId: number
  /** Writable task fields: title (required), description, due_date, priority, repeat_after, repeat_mode, reminders... */
  fields: OfflineTaskFields
  /** The task was completed before it ever reached the server. */
  done?: boolean
  labels?: OfflineLabelRef[]
  /** Pasted images; stored on disk and uploaded after the create replays. */
  images?: OfflineImageInput[]
}

export interface OfflineQueueItemView {
  id: string
  type: OfflineActionType
  /** One line for the UI, for example `Create "Buy milk"` or `Complete "Buy milk"`. */
  summary: string
  createdAt: string
  /** Replays that stopped on this action with an error that is neither network nor auth. */
  attempts: number
  /** The task the action changes (a negative temp id while its create is still pending). */
  taskId?: number
  /** Present for a pending create. */
  create?: {
    tempId: number
    /** `pending_<actionId>`, the id Quick View rows use. */
    pendingId: string
    projectId: number
    fields: OfflineTaskFields
    done: boolean
  }
}

export interface OfflineFailedItemView {
  /** The id of the action that failed; use it to retry or discard. */
  id: string
  type: OfflineActionType
  summary: string
  error: string
  statusCode?: number
  reason: OfflineFailureReason
  failedAt: string
  /** Entries that failed together (a create and the changes that depended on it) share this. */
  groupId?: string
  /** The task the action changed (a negative temp id for a create), so a row can show it failed. */
  taskId?: number
}

export interface OfflineQueueSnapshot {
  pending: OfflineQueueItemView[]
  failed: OfflineFailedItemView[]
  replaying: boolean
  /** Set while the queue is paused on a session / token problem; cleared by the next good replay. */
  authProblem: { error: string; since: string } | null
  /** `corrupt` when the queue file was unreadable and had no usable backup: pending changes were lost. */
  loadStatus: 'missing' | 'ok' | 'recovered' | 'corrupt'
}

export interface OfflineQueueCounts {
  pending: number
  failed: number
}

/** Sent as `offline-queue:changed` after every change to the queue. */
export interface OfflineQueueChange {
  counts: OfflineQueueCounts
  replaying: boolean
  authProblem: { error: string; since: string } | null
}

export interface OfflineReplayEvent {
  /** Actions the server accepted (or that were already in effect). */
  applied: number
  /** Actions that moved to the failed log during this replay. */
  failed: number
  stopped: OfflineReplayStop | null
  /** The error that stopped the replay, if any. */
  error?: string
  /** Temp id -> real id for every task created during this replay. */
  idMap: Record<string, number>
  counts: OfflineQueueCounts
}

export type OfflineQueueResult<T> = { success: true; data: T } | { success: false; error: string }

export interface OfflineEnqueueResult {
  /** The queued action. When the change folded into a pending create this is the create's id. */
  actionId: string
  /** The task the change applies to after resolving `pending_x` / remapped temp ids. */
  taskId: number
  /** True when the change merged into an action that was already queued. */
  folded: boolean
}

export interface OfflineCreateResult {
  actionId: string
  tempId: number
  /** `pending_<actionId>` */
  pendingId: string
}

export const OFFLINE_PENDING_ID_PREFIX = 'pending_'

/**
 * Options of the task write calls that go through the main process's write gate
 * (`update-task`, `delete-task`, `add-label-to-task`, `remove-label-from-task`). Without them a
 * call needs the server's answer: when changes for the task are still waiting in the queue it is
 * refused instead of being sent around them.
 */
export interface TaskWriteOptions {
  /** The caller can live with the change being queued (behind waiting changes, or when the server cannot be reached). */
  queue?: boolean
  /** The task's title, for the sync panel's summary line. */
  title?: string
  /** A label's title, kept with a queued "add label" so the replay can look the label up by name. */
  labelTitle?: string
}

/** What a queue-aware task write answers when the change went into the offline queue instead of the server. */
export interface QueuedWriteReply {
  success: true
  queued: true
  data: null
}
