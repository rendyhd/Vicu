import type { OfflineFailureReason } from '../../shared/offline-queue-types'

/**
 * The queue stores intent as merge patches, never full task snapshots (D-SYNC-2): replaying a
 * snapshot taken hours ago would overwrite whatever other devices changed since.
 *
 * Every task id in an action is a number. A task created offline has a negative temp id until its
 * create replays; the replay then rewrites the temp id in every later action (see
 * `remapTempId`).
 */

interface ActionBase {
  id: string
  createdAt: string
  /** Replays that stopped on this action with an error that is neither network nor auth. */
  attempts: number
  /** Task title for the summary line; display only. */
  title?: string
}

export interface CreateAction extends ActionBase {
  type: 'create'
  /** Negative; what every dependent action uses as `taskId` until the create replays. */
  tempId: number
  projectId: number
  /** Writable task fields exactly as they will be sent: title, description, due_date, priority, ... */
  fields: Record<string, unknown>
  /** Completed before it reached the server (a create has no `done` field, so a follow-up update sets it). */
  done?: boolean
  /**
   * A replay sent this create and got a timeout, a reset or a 500: the server may have created the
   * task anyway. This is what that attempt sent. The next attempt looks for a task like it before
   * posting again, so a retry cannot duplicate it, and applies whatever was edited since.
   */
  maybeSent?: { projectId: number; fields: Record<string, unknown> }
}

export interface UpdateAction extends ActionBase {
  type: 'update'
  taskId: number
  /** A `TaskPatch`: complete = `{ done }`, schedule = `{ due_date }`, clear date = `{ due_date: null }`. */
  patch: Record<string, unknown>
}

export interface DeleteAction extends ActionBase {
  type: 'delete'
  taskId: number
}

export interface AddLabelAction extends ActionBase {
  type: 'add-label'
  taskId: number
  /** Known label id, or filled in on replay after the label was looked up / created by title. */
  labelId?: number
  /** Looked up (case-insensitive) or created on replay when `labelId` is missing. */
  labelTitle?: string
}

export interface RemoveLabelAction extends ActionBase {
  type: 'remove-label'
  taskId: number
  labelId: number
}

export interface UploadAttachmentAction extends ActionBase {
  type: 'upload-attachment'
  taskId: number
  /** File name inside the offline attachments folder, never a path. */
  file: string
  /** Display name sent with the upload. */
  name: string
  mime: string
  /** Append the `[[image:N]]` token for this upload to the task description once it is uploaded. */
  addImageToken?: boolean
  /** The upload request already succeeded; a retry must not upload the file again. */
  uploaded?: boolean
}

export type QueuedAction =
  | CreateAction
  | UpdateAction
  | DeleteAction
  | AddLabelAction
  | RemoveLabelAction
  | UploadAttachmentAction

export type DependentAction = Exclude<QueuedAction, CreateAction>

export interface FailedAction {
  /** The failed action's own id. */
  id: string
  action: QueuedAction
  error: string
  statusCode?: number
  reason: OfflineFailureReason
  failedAt: string
  /** Shared by a create and the actions that could not run because it failed. */
  groupId?: string
}

/** The persisted queue file. */
export interface QueueData {
  version: 1
  actions: QueuedAction[]
  failed: FailedAction[]
  /**
   * Temp id (as a string) and `pending_<actionId>` -> real id for creates that replayed, so a
   * window that still holds the temp id can keep acting on the task. Capped.
   */
  resolved: Record<string, number>
  /** The most negative temp id handed out; temp ids only ever count down, across restarts. */
  lastTempId: number
}

export const MAX_RESOLVED_IDS = 500
export const PENDING_ID_PREFIX = 'pending_'

export function pendingIdFor(createActionId: string): string {
  return `${PENDING_ID_PREFIX}${createActionId}`
}

/** The actions that carry a `taskId`, that is, everything except a create. */
export function hasTaskId(action: QueuedAction): action is DependentAction {
  return action.type !== 'create'
}

export function emptyQueueData(): QueueData {
  return { version: 1, actions: [], failed: [], resolved: {}, lastTempId: 0 }
}
