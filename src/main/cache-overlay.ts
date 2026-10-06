import { NULL_DATE } from '../shared/merge-patches'
import { pendingIdFor, type QueuedAction } from './offline/types'

type Row = Record<string, unknown>

/** A queued patch as a cached row sees it: a cleared date is the Go zero time there, not null. */
function rowFields(patch: Record<string, unknown>): Row {
  const fields: Row = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'done') continue // handled as "hide the row"
    fields[key] = value === null && key.endsWith('_date') ? NULL_DATE : value
  }
  return fields
}

/**
 * Project the pending offline queue onto a cached task list so the offline Quick View reflects what
 * the user already did: completed or deleted rows disappear, edits and date changes rewrite rows,
 * and tasks created offline show up as placeholder rows with a `pending_<actionId>` id (which the
 * Quick View can complete and edit again, folding the change into the queued create).
 */
export function overlayPendingActions(cachedTasks: unknown[], actions: readonly QueuedAction[]): unknown[] {
  const rows = new Map<number, Row>()
  const hidden = new Set<number>()

  for (const task of cachedTasks) {
    const id = (task as { id?: unknown }).id
    if (typeof id === 'number') rows.set(id, task as Row)
  }

  const placeholders = new Map<number, Row>()
  for (const action of actions) {
    if (action.type !== 'create') continue
    const fields = action.fields
    placeholders.set(action.tempId, {
      id: pendingIdFor(action.id),
      title: fields.title,
      description: typeof fields.description === 'string' ? fields.description : '',
      due_date: typeof fields.due_date === 'string' ? fields.due_date : NULL_DATE,
      priority: typeof fields.priority === 'number' ? fields.priority : 0,
      repeat_after: typeof fields.repeat_after === 'number' ? fields.repeat_after : 0,
      repeat_mode: typeof fields.repeat_mode === 'number' ? fields.repeat_mode : 0,
      project_id: action.projectId,
      done: false,
      created: action.createdAt,
      updated: action.createdAt,
      pending: true,
    })
    if (action.done) hidden.add(action.tempId)
  }

  for (const action of actions) {
    if (action.type === 'create') continue
    if (action.type === 'delete') {
      hidden.add(action.taskId)
      continue
    }
    if (action.type !== 'update') continue

    if (action.patch.done === true) hidden.add(action.taskId)
    else if (action.patch.done === false) hidden.delete(action.taskId)

    const target = placeholders.get(action.taskId) ?? rows.get(action.taskId)
    if (!target) continue
    const next = { ...target, ...rowFields(action.patch) }
    if (placeholders.has(action.taskId)) placeholders.set(action.taskId, next)
    else rows.set(action.taskId, next)
  }

  const result: unknown[] = []
  for (const task of cachedTasks) {
    const id = (task as { id?: unknown }).id
    if (typeof id === 'number') {
      if (!hidden.has(id)) result.push(rows.get(id))
    } else {
      result.push(task)
    }
  }
  for (const [tempId, row] of placeholders) if (!hidden.has(tempId)) result.push(row)
  return result
}
