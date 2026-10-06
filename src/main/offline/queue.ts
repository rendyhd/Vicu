import { randomBytes } from 'crypto'
import { sanitizeAttachmentFileName } from '../attachment-safety'
import { JsonFileStore, type LoadStatus } from '../json-file-store'
import { sanitizeTaskPatch } from '../../shared/merge-patches'
import type {
  OfflineCreateInput,
  OfflineCreateResult,
  OfflineEnqueueResult,
  OfflineFailureReason,
  OfflineLabelRef,
  OfflineQueueCounts,
  OfflineQueueItemView,
  OfflineQueueSnapshot,
} from '../../shared/offline-queue-types'
import { OfflineAttachmentFiles } from './attachments'
import {
  cancelPatchKeys,
  mergeAddLabel,
  mergeDelete,
  mergeRemoveLabel,
  mergeUpdate,
  remapTempId,
  type MergeOutcome,
} from './queue-merge'
import { parseQueueData } from './queue-parse'
import { describeAction } from './summary'
import {
  MAX_RESOLVED_IDS,
  emptyQueueData,
  hasTaskId,
  pendingIdFor,
  type AddLabelAction,
  type CreateAction,
  type DeleteAction,
  type FailedAction,
  type QueueData,
  type QueuedAction,
  type RemoveLabelAction,
  type UpdateAction,
  type UploadAttachmentAction,
} from './types'

/** Failed actions stay visible this long, then the server's version of the task wins again. */
export const FAILED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const MAX_FAILED_ENTRIES = 100
/** Pasted images are stored on disk until they can be uploaded; keep an offline paste bounded. */
export const MAX_QUEUED_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_QUEUED_IMAGES = 20

export interface OfflineQueueOptions {
  queuePath: string
  attachmentsDir: string
  now?: () => Date
  newId?: () => string
}

export interface FailureInfo {
  error: string
  statusCode?: number
  reason: OfflineFailureReason
}

interface Meta {
  /** Task title for the summary line. */
  title?: string
}

const IMAGE_MIME = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i

/**
 * The offline queue: pending actions, the failed log, temp-id bookkeeping and their persistence
 * (D-SYNC-2/3/4/5, D-QE-1). It has no Electron or network dependency, so everything here runs in
 * unit tests against a temp folder.
 *
 * All state lives in memory and every mutation is applied synchronously, then persisted with an
 * atomic async write. Each mutating method returns a promise that resolves once the change is on
 * disk, so a caller that tells the user "saved offline" can wait for it. Because the in-memory
 * change happens before the first `await`, concurrent calls are applied in call order.
 */
export class OfflineQueue {
  readonly files: OfflineAttachmentFiles
  loadStatus: LoadStatus = 'missing'

  private readonly store: JsonFileStore<QueueData>
  private readonly now: () => Date
  private readonly newId: () => string
  private readonly listeners = new Set<() => void>()
  private inFlightId: string | null = null
  private replaying = false
  private authProblem: { error: string; since: string } | null = null

  constructor(options: OfflineQueueOptions) {
    this.now = options.now ?? (() => new Date())
    this.newId = options.newId ?? (() => randomBytes(8).toString('hex'))
    this.files = new OfflineAttachmentFiles(options.attachmentsDir)
    this.store = new JsonFileStore<QueueData>({
      path: options.queuePath,
      backup: true,
      quarantineCorrupt: true,
      label: 'offline queue',
      empty: emptyQueueData,
      parse: parseQueueData,
    })
  }

  private get data(): QueueData {
    return this.store.state
  }

  /** Read the queue file (once, synchronously, at startup). A corrupt file falls back to its `.bak`. */
  load(): LoadStatus {
    this.loadStatus = this.store.load()
    if (this.pruneFailed().length > 0) void this.store.save().catch(() => {})
    return this.loadStatus
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        console.warn('[offline-queue] change listener failed:', err instanceof Error ? err.message : err)
      }
    }
  }

  // --- Reads (memory only) ---------------------------------------------------------------

  getPending(): readonly QueuedAction[] {
    return this.data.actions
  }

  getFailed(): readonly FailedAction[] {
    return this.data.failed
  }

  counts(): OfflineQueueCounts {
    return { pending: this.data.actions.length, failed: this.data.failed.length }
  }

  snapshot(): OfflineQueueSnapshot {
    const all = this.data.actions
    return {
      pending: all.map((a): OfflineQueueItemView => {
        const view: OfflineQueueItemView = {
          id: a.id,
          type: a.type,
          summary: describeAction(a, all),
          createdAt: a.createdAt,
          attempts: a.attempts,
        }
        if (hasTaskId(a)) view.taskId = a.taskId
        else {
          view.taskId = a.tempId
          view.create = {
            tempId: a.tempId,
            pendingId: pendingIdFor(a.id),
            projectId: a.projectId,
            fields: a.fields,
            done: a.done === true,
          }
        }
        return view
      }),
      failed: this.data.failed.map((f) => ({
        id: f.id,
        type: f.action.type,
        summary: describeAction(f.action, all),
        error: f.error,
        statusCode: f.statusCode,
        reason: f.reason,
        failedAt: f.failedAt,
        groupId: f.groupId,
      })),
      replaying: this.replaying,
      authProblem: this.authProblem,
      loadStatus: this.loadStatus,
    }
  }

  /**
   * Turn whatever a window calls a task into the number the queue uses: a real id, a negative temp
   * id still pending, `pending_<actionId>`, or either of those after the create replayed (the
   * real id). Null when the task is not known: it was never queued, or its create failed.
   */
  resolveTaskRef(ref: number | string): number | null {
    if (typeof ref === 'string') {
      const trimmed = ref.trim()
      if (trimmed.startsWith('pending_')) {
        const create = this.data.actions.find((a): a is CreateAction => a.type === 'create' && pendingIdFor(a.id) === trimmed)
        if (create) return create.tempId
        return this.data.resolved[trimmed] ?? null
      }
      if (!/^-?\d+$/.test(trimmed)) return null
      return this.resolveTaskRef(Number(trimmed))
    }

    if (!Number.isInteger(ref) || ref === 0) return null
    if (ref > 0) return ref
    if (this.data.actions.some((a) => a.type === 'create' && a.tempId === ref)) return ref
    return this.data.resolved[String(ref)] ?? null
  }

  private requireTask(ref: number | string): number {
    const taskId = this.resolveTaskRef(ref)
    if (taskId === null) throw new Error('That task is not waiting to be created any more')
    return taskId
  }

  // --- Enqueue -----------------------------------------------------------------------------

  /** The fields every action carries. */
  private stamp(meta: Meta = {}): { id: string; createdAt: string; attempts: 0; title?: string } {
    const base = { id: this.newId(), createdAt: this.now().toISOString(), attempts: 0 as const }
    return meta.title ? { ...base, title: meta.title } : base
  }

  private apply(outcome: MergeOutcome): Promise<void> {
    this.data.actions = outcome.actions
    return this.commit(outcome.removed)
  }

  /**
   * Queue a change to a task's fields as a merge patch. Merges into a queued update of the same
   * task, or into the task's pending create (an edit of a task that was never created is just a
   * better create).
   */
  async enqueueUpdate(ref: number | string, patch: Record<string, unknown>, meta: Meta = {}): Promise<OfflineEnqueueResult> {
    const taskId = this.requireTask(ref)
    const action: UpdateAction = { ...this.stamp(meta), type: 'update', taskId, patch: { ...sanitizeTaskPatch(patch) } }
    const outcome = mergeUpdate(this.data.actions, action, this.inFlightId)
    if (outcome.noop && outcome.removed.length === 0) return { actionId: '', taskId, folded: true }
    await this.apply(outcome)
    return { actionId: outcome.foldedInto ?? action.id, taskId, folded: !outcome.appended }
  }

  /** Complete or reopen a task: `enqueueUpdate(ref, { done })`. */
  enqueueComplete(ref: number | string, done: boolean, meta: Meta = {}): Promise<OfflineEnqueueResult> {
    return this.enqueueUpdate(ref, { done }, meta)
  }

  /** Delete a task. A task that only exists as a pending create just disappears from the queue. */
  async enqueueDelete(ref: number | string, meta: Meta = {}): Promise<OfflineEnqueueResult> {
    const taskId = this.requireTask(ref)
    const action: DeleteAction = { ...this.stamp(meta), type: 'delete', taskId }
    const outcome = mergeDelete(this.data.actions, action, this.inFlightId)
    if (outcome.noop && outcome.removed.length === 0) return { actionId: '', taskId, folded: true }
    await this.apply(outcome)
    return { actionId: action.id, taskId, folded: !outcome.appended }
  }

  async enqueueAddLabel(ref: number | string, label: OfflineLabelRef, meta: Meta = {}): Promise<OfflineEnqueueResult> {
    const taskId = this.requireTask(ref)
    if (label.id === undefined && !label.title?.trim()) throw new Error('A label needs an id or a title')
    const action: AddLabelAction = {
      ...this.stamp(meta),
      type: 'add-label',
      taskId,
      labelId: label.id,
      labelTitle: label.title?.trim() || undefined,
    }
    const outcome = mergeAddLabel(this.data.actions, action, this.inFlightId)
    if (outcome.noop && outcome.removed.length === 0) return { actionId: '', taskId, folded: true }
    await this.apply(outcome)
    return { actionId: action.id, taskId, folded: !outcome.appended }
  }

  async enqueueRemoveLabel(ref: number | string, labelId: number, meta: Meta = {}): Promise<OfflineEnqueueResult> {
    const taskId = this.requireTask(ref)
    const action: RemoveLabelAction = { ...this.stamp(meta), type: 'remove-label', taskId, labelId }
    const outcome = mergeRemoveLabel(this.data.actions, action, this.inFlightId)
    if (outcome.noop && outcome.removed.length === 0) return { actionId: '', taskId, folded: true }
    await this.apply(outcome)
    return { actionId: action.id, taskId, folded: !outcome.appended }
  }

  /**
   * Queue a new task with everything the user set. Labels and pasted images become follow-up
   * actions bound to the task's temp id; images are written to disk first (D-QE-1).
   */
  async enqueueCreate(input: OfflineCreateInput): Promise<OfflineCreateResult> {
    if (!Number.isInteger(input.projectId) || input.projectId <= 0) throw new Error('A task needs a project')
    const fields = createFields(input.fields)

    const images = input.images ?? []
    if (images.length > MAX_QUEUED_IMAGES) throw new Error(`Too many images to save offline (limit ${MAX_QUEUED_IMAGES})`)
    for (const image of images) {
      if (image.bytes.byteLength > MAX_QUEUED_IMAGE_BYTES) {
        throw new Error(`"${image.name}" is too large to save offline (limit ${MAX_QUEUED_IMAGE_BYTES / 1024 / 1024} MB)`)
      }
    }

    const stored: Array<{ file: string; name: string; mime: string }> = []
    try {
      for (const image of images) {
        stored.push({
          file: await this.files.save(image.bytes),
          name: sanitizeAttachmentFileName(image.name, 'image'),
          mime: IMAGE_MIME.test(image.mime) ? image.mime : 'application/octet-stream',
        })
      }
    } catch (err) {
      await Promise.all(stored.map((s) => this.files.remove(s.file).catch(() => {})))
      throw err
    }

    const tempId = this.data.lastTempId - 1
    this.data.lastTempId = tempId
    const meta: Meta = { title: fields.title as string }

    const create: CreateAction = {
      ...this.stamp(meta),
      type: 'create',
      tempId,
      projectId: input.projectId,
      fields,
      ...(input.done ? { done: true } : {}),
    }

    const added: QueuedAction[] = [create]
    const seen = new Set<string>()
    for (const label of input.labels ?? []) {
      const key = label.id !== undefined ? `id:${label.id}` : `title:${(label.title ?? '').trim().toLowerCase()}`
      if ((label.id === undefined && !label.title?.trim()) || seen.has(key)) continue
      seen.add(key)
      added.push({
        ...this.stamp(meta),
        type: 'add-label',
        taskId: tempId,
        labelId: label.id,
        labelTitle: label.title?.trim() || undefined,
      })
    }
    for (const s of stored) {
      added.push({
        ...this.stamp(meta),
        type: 'upload-attachment',
        taskId: tempId,
        file: s.file,
        name: s.name,
        mime: s.mime,
        addImageToken: true,
      })
    }

    this.data.actions = [...this.data.actions, ...added]
    await this.commit()
    return { actionId: create.id, tempId, pendingId: pendingIdFor(create.id) }
  }

  /**
   * Take a queued change back out (the undo of a queued completion). Resolves to true when the
   * change never has to reach the server; false means nothing was queued for those keys or it is
   * being sent right now, and the caller queues the opposite change instead.
   */
  async cancelChange(ref: number | string, keys: readonly string[]): Promise<boolean> {
    const taskId = this.resolveTaskRef(ref)
    if (taskId === null) return false
    const outcome = cancelPatchKeys(this.data.actions, taskId, keys, this.inFlightId)
    if (outcome.actions === this.data.actions || (!outcome.cancelled && outcome.removed.length === 0)) return false
    this.data.actions = outcome.actions
    await this.commit(outcome.removed)
    return outcome.cancelled
  }

  /** Remove pending actions the user no longer wants. Removing a create removes what depends on it. */
  async discardPending(ids: readonly string[]): Promise<number> {
    const wanted = new Set(ids)
    const roots = this.data.actions.filter((a) => wanted.has(a.id))
    const doomed = new Set(roots.map((a) => a.id))
    for (const a of roots) {
      if (a.type === 'create') {
        for (const d of this.data.actions) if (hasTaskId(d) && d.taskId === a.tempId) doomed.add(d.id)
      }
    }
    const removed = this.data.actions.filter((a) => doomed.has(a.id))
    if (removed.length === 0) return 0
    this.data.actions = this.data.actions.filter((a) => !doomed.has(a.id))
    await this.commit(removed)
    return removed.length
  }

  /**
   * Put failed actions back in the queue, with a fresh attempt count, in their original order. An
   * action that failed together with others (a create and what depended on it) comes back together.
   */
  async retryFailed(ids?: readonly string[]): Promise<number> {
    const picked = this.pickFailed(ids)
    if (picked.length === 0) return 0
    const pickedIds = new Set(picked.map((f) => f.id))
    this.data.failed = this.data.failed.filter((f) => !pickedIds.has(f.id))
    const revived = picked.map((f): QueuedAction => ({ ...f.action, attempts: 0 }))
    this.data.actions = [...this.data.actions, ...revived]
      .map((action, index) => ({ action, index }))
      .sort((a, b) => (a.action.createdAt < b.action.createdAt ? -1 : a.action.createdAt > b.action.createdAt ? 1 : a.index - b.index))
      .map((entry) => entry.action)
    await this.commit()
    return revived.length
  }

  async discardFailed(ids?: readonly string[]): Promise<number> {
    const picked = this.pickFailed(ids)
    if (picked.length === 0) return 0
    const pickedIds = new Set(picked.map((f) => f.id))
    this.data.failed = this.data.failed.filter((f) => !pickedIds.has(f.id))
    await this.commit(picked.map((f) => f.action))
    return picked.length
  }

  private pickFailed(ids?: readonly string[]): FailedAction[] {
    if (!ids) return this.data.failed.slice()
    const wanted = new Set(ids)
    const groups = new Set<string>()
    for (const f of this.data.failed) if (wanted.has(f.id) && f.groupId) groups.add(f.groupId)
    return this.data.failed.filter((f) => wanted.has(f.id) || (f.groupId !== undefined && groups.has(f.groupId)))
  }

  // --- Replay support ----------------------------------------------------------------------

  /** The action to send next, or null. The queue is replayed from the front, in order. */
  nextAction(): QueuedAction | null {
    return this.data.actions[0] ?? null
  }

  /**
   * Mark an action as being sent. While it is, folds and cancels leave it alone and queue behind
   * it. Returns false when it is no longer queued (removed or folded since it was picked).
   */
  beginSend(id: string): boolean {
    if (!this.data.actions.some((a) => a.id === id)) return false
    this.inFlightId = id
    return true
  }

  endSend(): void {
    this.inFlightId = null
  }

  /** Still queued: the check before every request, so an action discarded mid-replay is not sent. */
  isQueued(id: string): boolean {
    return this.data.actions.some((a) => a.id === id)
  }

  getAction(id: string): QueuedAction | undefined {
    return this.data.actions.find((a) => a.id === id)
  }

  /** The server accepted the action (or it was already in effect). */
  async completeAction(id: string, result: { realId?: number } = {}): Promise<void> {
    const index = this.data.actions.findIndex((a) => a.id === id)
    if (index === -1) return
    const action = this.data.actions[index]
    let actions = [...this.data.actions.slice(0, index), ...this.data.actions.slice(index + 1)]

    if (action.type === 'create' && result.realId !== undefined) {
      actions = remapTempId(actions, action.tempId, result.realId)
      this.data.resolved[String(action.tempId)] = result.realId
      this.data.resolved[pendingIdFor(action.id)] = result.realId
      this.trimResolved()
      if (action.done) {
        // A create has no `done` field: complete the new task with an update that runs next.
        const done: UpdateAction = {
          ...this.stamp({ title: action.title }),
          type: 'update',
          taskId: result.realId,
          patch: { done: true },
        }
        actions.splice(index, 0, done)
      }
      this.data.failed = this.data.failed.map((f) =>
        hasTaskId(f.action) && f.action.taskId === action.tempId ? { ...f, action: { ...f.action, taskId: result.realId! } as QueuedAction } : f
      )
    }

    this.data.actions = actions
    await this.commit([action])
  }

  /**
   * The server refused the action for good: move it to the failed log. When it is a create, the
   * actions that depend on it can never run and move with it, flagged as such.
   */
  async failAction(id: string, failure: FailureInfo): Promise<void> {
    const index = this.data.actions.findIndex((a) => a.id === id)
    if (index === -1) return
    const action = this.data.actions[index]
    const failedAt = this.now().toISOString()
    const entries: FailedAction[] = [{ id: action.id, action, error: failure.error, statusCode: failure.statusCode, reason: failure.reason, failedAt }]
    const doomed = new Set([action.id])

    if (action.type === 'create') {
      const label = typeof action.fields.title === 'string' ? `"${action.fields.title}"` : 'the task'
      for (const dependent of this.data.actions) {
        if (hasTaskId(dependent) && dependent.taskId === action.tempId) {
          doomed.add(dependent.id)
          entries.push({
            id: dependent.id,
            action: dependent,
            error: `Not sent because ${label} could not be created`,
            reason: 'dependency-failed',
            failedAt,
            groupId: action.id,
          })
        }
      }
      if (entries.length > 1) entries[0].groupId = action.id
    }

    this.data.actions = this.data.actions.filter((a) => !doomed.has(a.id))
    this.data.failed = [...this.data.failed, ...entries]
    const pruned = this.pruneFailed()
    await this.commit(pruned)
  }

  /** Count a replay that stopped on this action for a reason that is neither network nor auth. */
  async recordAttempt(id: string): Promise<number> {
    const index = this.data.actions.findIndex((a) => a.id === id)
    if (index === -1) return 0
    const attempts = this.data.actions[index].attempts + 1
    this.data.actions = this.data.actions.map((a, i) => (i === index ? { ...a, attempts } : a))
    await this.commit()
    return attempts
  }

  /** Persist progress inside an action (a resolved label id, "already uploaded"). */
  async patchAction(id: string, changes: { labelId?: number; uploaded?: boolean }): Promise<void> {
    const index = this.data.actions.findIndex((a) => a.id === id)
    if (index === -1) return
    this.data.actions = this.data.actions.map((a, i) => (i === index ? ({ ...a, ...changes } as QueuedAction) : a))
    await this.commit()
  }

  setReplaying(replaying: boolean): void {
    if (this.replaying === replaying) return
    this.replaying = replaying
    this.emit()
  }

  setAuthProblem(error: string | null): void {
    const next = error === null ? null : { error, since: this.authProblem?.since ?? this.now().toISOString() }
    if (next === null && this.authProblem === null) return
    this.authProblem = next
    this.emit()
  }

  // --- Housekeeping ------------------------------------------------------------------------

  /** Delete image files that no pending or failed action refers to. Run once after `load()`. */
  async sweepOrphans(): Promise<number> {
    const keep = new Set<string>()
    for (const a of this.data.actions) if (a.type === 'upload-attachment') keep.add(a.file)
    for (const f of this.data.failed) if (f.action.type === 'upload-attachment') keep.add(f.action.file)
    return this.files.sweep(keep)
  }

  /** Wait for every write started so far. Called before the app quits. */
  flush(): Promise<void> {
    return this.store.flush()
  }

  get hasUnsavedChanges(): boolean {
    return this.store.hasUnsavedChanges
  }

  private trimResolved(): void {
    const keys = Object.keys(this.data.resolved)
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_RESOLVED_IDS))) delete this.data.resolved[key]
  }

  /** Drop failed entries past the retention window or the cap. Returns the removed actions. */
  private pruneFailed(): QueuedAction[] {
    const cutoff = this.now().getTime() - FAILED_RETENTION_MS
    let kept = this.data.failed.filter((f) => Date.parse(f.failedAt) >= cutoff || Number.isNaN(Date.parse(f.failedAt)))
    if (kept.length > MAX_FAILED_ENTRIES) kept = kept.slice(kept.length - MAX_FAILED_ENTRIES)
    if (kept.length === this.data.failed.length) return []
    const keptIds = new Set(kept.map((f) => f.id))
    const removed = this.data.failed.filter((f) => !keptIds.has(f.id)).map((f) => f.action)
    this.data.failed = kept
    return removed
  }

  /** Announce the change, persist it, then delete the files of actions that left the queue. */
  private async commit(removed: readonly QueuedAction[] = []): Promise<void> {
    this.emit()
    await this.store.save()
    // Files go only after the queue file no longer refers to them: a crash in between leaves an
    // orphan (swept at startup), never an action whose file is gone.
    const doomed = removed.filter((a): a is UploadAttachmentAction => a.type === 'upload-attachment')
    await Promise.all(
      doomed.map((a) =>
        this.files.remove(a.file).catch((err) => console.warn('[offline-queue] could not delete', a.file, err instanceof Error ? err.message : err))
      )
    )
  }
}

/** Reduce create input to the writable fields that can be sent in a POST: no done, no project, no nulls. */
export function createFields(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('A task needs a title')
  const fields: Record<string, unknown> = { ...sanitizeTaskPatch(input) }
  delete fields.done
  delete fields.project_id
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) delete fields[key]
  }
  return fields
}
