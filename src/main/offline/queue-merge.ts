import type {
  AddAssigneeAction,
  AddLabelAction,
  CreateAction,
  CreateCommentAction,
  DeleteAction,
  DeleteCommentAction,
  QueuedAction,
  RemoveAssigneeAction,
  RemoveLabelAction,
  UpdateAction,
  UpdateCommentAction,
  AddRelationAction,
  RemoveRelationAction,
} from './types'
import { hasTaskId } from './types'

/**
 * Pure fold rules for the offline queue, a port of Android's `QueueMerge` (`resolveTaskQueueMerge`
 * and `mergePatchPayloads`) adapted to patch actions. Every function takes the current actions and
 * the id of the action being sent right now (or null) and returns new arrays; nothing is mutated.
 *
 * The in-flight action is never changed or removed here. Its request is already on the wire, so
 * folding into it would lose the change when it finishes (the replay removes it) and removing it
 * would not unsend it. A change to the same task is queued behind it instead.
 */

export interface MergeOutcome {
  actions: QueuedAction[]
  /** Actions this operation removed, so their attachment files can be deleted. */
  removed: QueuedAction[]
  /** The existing action the change was merged into, or null. */
  foldedInto: string | null
  /** The change was added as an action of its own. */
  appended: boolean
  /** The change was not added and not merged: it was moot or it cancelled something out. */
  noop: boolean
}

function outcome(
  actions: QueuedAction[],
  parts: { removed?: QueuedAction[]; foldedInto?: string | null; appended?: boolean }
): MergeOutcome {
  const foldedInto = parts.foldedInto ?? null
  const appended = parts.appended ?? false
  return {
    actions,
    removed: parts.removed ?? [],
    foldedInto,
    appended,
    noop: !appended && foldedInto === null,
  }
}

function isPendingCreate(action: QueuedAction, tempId: number, inFlightId: string | null): action is CreateAction {
  return action.type === 'create' && action.tempId === tempId && action.id !== inFlightId
}

/** Put a patch into a create: `done` and `project_id` are not create fields, `null` means "no value". */
function foldPatchIntoCreate(create: CreateAction, patch: Record<string, unknown>): CreateAction {
  const fields = { ...create.fields }
  let projectId = create.projectId
  let done = create.done
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'done') {
      done = value === true ? true : undefined
    } else if (key === 'project_id') {
      if (typeof value === 'number') projectId = value
    } else if (value === null || value === undefined) {
      delete fields[key]
    } else {
      fields[key] = value
    }
  }
  const next: CreateAction = { ...create, fields, projectId }
  if (done) next.done = true
  else delete next.done
  return next
}

function replaceAt(actions: QueuedAction[], index: number, next: QueuedAction): QueuedAction[] {
  const copy = actions.slice()
  copy[index] = next
  return copy
}

/**
 * Queue a change to a task's fields.
 *
 * - Pending create: fold into it (update + create = create with merged fields; a completion
 *   becomes `done` on the create).
 * - Queued update for the same task: merge the patches, newest values win.
 * - A delete is already queued: the change is moot.
 * - Otherwise: append.
 */
export function mergeUpdate(actions: QueuedAction[], next: UpdateAction, inFlightId: string | null): MergeOutcome {
  if (Object.keys(next.patch).length === 0) return outcome(actions, {})

  const createIndex = actions.findIndex((a) => isPendingCreate(a, next.taskId, inFlightId))
  if (createIndex !== -1) {
    const create = actions[createIndex] as CreateAction
    return outcome(replaceAt(actions, createIndex, foldPatchIntoCreate(create, next.patch)), { foldedInto: create.id })
  }

  if (actions.some((a) => a.type === 'delete' && a.taskId === next.taskId)) return outcome(actions, {})

  const existingIndex = actions.findIndex((a) => a.type === 'update' && a.taskId === next.taskId && a.id !== inFlightId)
  if (existingIndex !== -1) {
    const existing = actions[existingIndex] as UpdateAction
    const merged: UpdateAction = { ...existing, patch: { ...existing.patch, ...next.patch } }
    if (next.title !== undefined) merged.title = next.title
    return outcome(replaceAt(actions, existingIndex, merged), { foldedInto: existing.id })
  }

  return outcome([...actions, next], { appended: true })
}

/**
 * Queue a delete.
 *
 * - Pending create: remove it and everything that depends on it (delete + create = both removed;
 *   the server never needs to know).
 * - Otherwise: drop queued changes to the task that the delete makes moot and append one delete.
 */
export function mergeDelete(actions: QueuedAction[], next: DeleteAction, inFlightId: string | null): MergeOutcome {
  const dependent = (a: QueuedAction): boolean => hasTaskId(a) && a.taskId === next.taskId && a.type !== 'delete'
  const createIndex = actions.findIndex((a) => isPendingCreate(a, next.taskId, inFlightId))

  if (createIndex !== -1) {
    const removed = actions.filter((a, i) => i === createIndex || (dependent(a) && a.id !== inFlightId))
    const removedIds = new Set(removed.map((a) => a.id))
    return outcome(
      actions.filter((a) => !removedIds.has(a.id)),
      { removed }
    )
  }

  if (actions.some((a) => a.type === 'delete' && a.taskId === next.taskId)) return outcome(actions, {})

  const removed = actions.filter((a) => dependent(a) && a.id !== inFlightId)
  const removedIds = new Set(removed.map((a) => a.id))
  return outcome([...actions.filter((a) => !removedIds.has(a.id)), next], { removed, appended: true })
}

function sameLabel(a: { labelId?: number; labelTitle?: string }, b: { labelId?: number; labelTitle?: string }): boolean {
  if (a.labelId !== undefined && b.labelId !== undefined) return a.labelId === b.labelId
  if (a.labelTitle && b.labelTitle) return a.labelTitle.trim().toLowerCase() === b.labelTitle.trim().toLowerCase()
  return false
}

/** Queue "put this label on the task". Cancels a queued removal of the same label. */
export function mergeAddLabel(actions: QueuedAction[], next: AddLabelAction, inFlightId: string | null): MergeOutcome {
  const same = actions.find(
    (a): a is AddLabelAction => a.type === 'add-label' && a.taskId === next.taskId && sameLabel(a, next)
  )
  if (same) return outcome(actions, {})

  const removal = actions.find(
    (a): a is RemoveLabelAction =>
      a.type === 'remove-label' &&
      a.taskId === next.taskId &&
      a.id !== inFlightId &&
      next.labelId !== undefined &&
      a.labelId === next.labelId
  )
  if (removal) return outcome(actions.filter((a) => a.id !== removal.id), { removed: [removal] })

  return outcome([...actions, next], { appended: true })
}

/** Queue "take this label off the task". Cancels a queued addition of the same label. */
export function mergeRemoveLabel(actions: QueuedAction[], next: RemoveLabelAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'remove-label' && a.taskId === next.taskId && a.labelId === next.labelId)) {
    return outcome(actions, {})
  }

  const addition = actions.find(
    (a): a is AddLabelAction =>
      a.type === 'add-label' && a.taskId === next.taskId && a.id !== inFlightId && sameLabel(a, next)
  )
  if (addition) return outcome(actions.filter((a) => a.id !== addition.id), { removed: [addition] })

  return outcome([...actions, next], { appended: true })
}

/** Queue "assign this user". Cancels a queued unassign of the same user on the same task. */
export function mergeAddAssignee(actions: QueuedAction[], next: AddAssigneeAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'add-assignee' && a.taskId === next.taskId && a.userId === next.userId)) {
    return outcome(actions, {})
  }
  const removal = actions.find(
    (a): a is RemoveAssigneeAction =>
      a.type === 'remove-assignee' && a.taskId === next.taskId && a.userId === next.userId && a.id !== inFlightId
  )
  if (removal) return outcome(actions.filter((a) => a.id !== removal.id), { removed: [removal] })
  return outcome([...actions, next], { appended: true })
}

/** Queue "unassign this user". Cancels a queued assign of the same user on the same task. */
export function mergeRemoveAssignee(actions: QueuedAction[], next: RemoveAssigneeAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'remove-assignee' && a.taskId === next.taskId && a.userId === next.userId)) {
    return outcome(actions, {})
  }
  const addition = actions.find(
    (a): a is AddAssigneeAction =>
      a.type === 'add-assignee' && a.taskId === next.taskId && a.userId === next.userId && a.id !== inFlightId
  )
  if (addition) return outcome(actions.filter((a) => a.id !== addition.id), { removed: [addition] })
  return outcome([...actions, next], { appended: true })
}

/** Queue a new comment: always its own action, at the end. */
export function mergeCreateComment(actions: QueuedAction[], next: CreateCommentAction): MergeOutcome {
  return outcome([...actions, next], { appended: true })
}

/**
 * Queue an edit of a comment. An edit of a comment that is still waiting to be created goes into
 * the create; an edit of a comment with a queued edit replaces that edit's text.
 */
export function mergeUpdateComment(actions: QueuedAction[], next: UpdateCommentAction, inFlightId: string | null): MergeOutcome {
  const createIndex = actions.findIndex(
    (a) => a.type === 'create-comment' && a.tempCommentId === next.commentId && a.id !== inFlightId
  )
  if (createIndex !== -1) {
    const create = actions[createIndex] as CreateCommentAction
    return outcome(replaceAt(actions, createIndex, { ...create, comment: next.comment }), { foldedInto: create.id })
  }
  const editIndex = actions.findIndex(
    (a) => a.type === 'update-comment' && a.commentId === next.commentId && a.id !== inFlightId
  )
  if (editIndex !== -1) {
    const edit = actions[editIndex] as UpdateCommentAction
    return outcome(replaceAt(actions, editIndex, { ...edit, comment: next.comment }), { foldedInto: edit.id })
  }
  return outcome([...actions, next], { appended: true })
}

/**
 * Queue the deletion of a comment. A comment that is still waiting to be created just disappears
 * from the queue with its edits; queued edits of any other comment are dropped before the delete.
 */
export function mergeDeleteComment(actions: QueuedAction[], next: DeleteCommentAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'delete-comment' && a.commentId === next.commentId)) return outcome(actions, {})
  const touches = (a: QueuedAction): boolean =>
    a.id !== inFlightId &&
    ((a.type === 'create-comment' && a.tempCommentId === next.commentId) ||
      (a.type === 'update-comment' && a.commentId === next.commentId))
  const removed = actions.filter(touches)
  const kept = actions.filter((a) => !touches(a))
  const pendingCreate = removed.some((a) => a.type === 'create-comment')
  if (pendingCreate) return outcome(kept, { removed })
  return outcome([...kept, next], { removed, appended: true })
}

/** Point queued edits and deletes of a comment that was waiting to be created at its real id. */
export function remapTempCommentId(actions: QueuedAction[], tempCommentId: number, realId: number): QueuedAction[] {
  return actions.map((a) =>
    (a.type === 'update-comment' || a.type === 'delete-comment') && a.commentId === tempCommentId ? { ...a, commentId: realId } : a
  )
}

export interface CancelOutcome {
  actions: QueuedAction[]
  removed: QueuedAction[]
  /**
   * True when a queued change to one of `keys` was taken back out of the queue, so the server will
   * never see it and no compensating update is needed. False when nothing was queued for those
   * keys, or the change is already being sent: the caller then queues the opposite change.
   */
  cancelled: boolean
}

/**
 * Take a change back out of the queue (the undo of a queued completion, say). Removes `keys` from
 * the pending create or the queued update of the task, and drops an update that ends up empty.
 */
export function cancelPatchKeys(
  actions: QueuedAction[],
  taskId: number,
  keys: readonly string[],
  inFlightId: string | null
): CancelOutcome {
  let cancelled = false
  let sentKeyInFlight = false
  const removed: QueuedAction[] = []
  const next: QueuedAction[] = []

  for (const action of actions) {
    const isTarget =
      (action.type === 'update' && action.taskId === taskId) || (action.type === 'create' && action.tempId === taskId)
    if (!isTarget) {
      next.push(action)
      continue
    }

    if (action.id === inFlightId) {
      const sent = action.type === 'update' ? action.patch : { ...action.fields, ...(action.done ? { done: true } : {}) }
      if (keys.some((k) => k in sent)) sentKeyInFlight = true
      next.push(action)
      continue
    }

    if (action.type === 'update') {
      const patch = { ...action.patch }
      let touched = false
      for (const key of keys) {
        if (key in patch) {
          delete patch[key]
          touched = true
        }
      }
      if (!touched) {
        next.push(action)
        continue
      }
      cancelled = true
      if (Object.keys(patch).length === 0) removed.push(action)
      else next.push({ ...action, patch })
    } else if (action.type === 'create') {
      const fields = { ...action.fields }
      let touched = false
      for (const key of keys) {
        if (key in fields) {
          delete fields[key]
          touched = true
        }
      }
      const clone: CreateAction = { ...action, fields }
      if (keys.includes('done') && action.done) {
        delete clone.done
        touched = true
      }
      if (touched) cancelled = true
      next.push(touched ? clone : action)
    }
  }

  return { actions: next, removed, cancelled: cancelled && !sentKeyInFlight }
}

/**
 * Point every action that follows a create at the task's real id. Untouched actions are reused.
 * `title`, the created task's final title, names the task in summaries once its temp id is gone.
 */
export function remapTempId(actions: QueuedAction[], tempId: number, realId: number, title?: string): QueuedAction[] {
  return actions.map((a) => {
    // A relation names a second task, which may be the one just created.
    const other = (a.type === 'add-relation' || a.type === 'remove-relation') && a.otherTaskId === tempId
    if (!hasTaskId(a) || (a.taskId !== tempId && !other)) return a
    const remapped = { ...a, ...(a.taskId === tempId ? { taskId: realId } : {}), ...(other ? { otherTaskId: realId } : {}) } as QueuedAction
    if (title && !remapped.title && a.taskId === tempId) remapped.title = title
    return remapped
  })
}

const sameRelation = (a: { taskId: number; otherTaskId: number; kind: string }, b: { taskId: number; otherTaskId: number; kind: string }) =>
  a.taskId === b.taskId && a.otherTaskId === b.otherTaskId && a.kind === b.kind

/** Queue a relation. Cancels a queued removal of the same relation (decision 24). */
export function mergeAddRelation(actions: QueuedAction[], next: AddRelationAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'add-relation' && sameRelation(a, next))) return outcome(actions, {})
  const removal = actions.find((a): a is RemoveRelationAction => a.type === 'remove-relation' && sameRelation(a, next) && a.id !== inFlightId)
  if (removal) return outcome(actions.filter((a) => a.id !== removal.id), { removed: [removal] })
  return outcome([...actions, next], { appended: true })
}

/** Queue a relation's removal. Cancels a queued add of the same relation. */
export function mergeRemoveRelation(actions: QueuedAction[], next: RemoveRelationAction, inFlightId: string | null): MergeOutcome {
  if (actions.some((a) => a.type === 'remove-relation' && sameRelation(a, next))) return outcome(actions, {})
  const addition = actions.find((a): a is AddRelationAction => a.type === 'add-relation' && sameRelation(a, next) && a.id !== inFlightId)
  if (addition) return outcome(actions.filter((a) => a.id !== addition.id), { removed: [addition] })
  return outcome([...actions, next], { appended: true })
}
