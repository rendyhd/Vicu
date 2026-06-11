import type { PendingAction } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

export type ReplayRequest =
  | { kind: 'create'; projectId: number; payload: Record<string, unknown> }
  | { kind: 'update'; taskId: number; payload: Record<string, unknown> }
  | { kind: 'skip' }

/**
 * Map a queued offline action to the API request that replays it.
 * Updates spread the stored full task object first (Go zero-value rule —
 * Vikunja zeroes any field missing from an update body).
 */
export function actionToRequest(action: PendingAction): ReplayRequest {
  switch (action.type) {
    case 'create': {
      if (typeof action.projectId !== 'number' || !action.title) return { kind: 'skip' }
      const payload: Record<string, unknown> = { title: action.title }
      if (action.description) payload.description = action.description
      if (action.dueDate) payload.due_date = action.dueDate
      return { kind: 'create', projectId: action.projectId, payload }
    }
    case 'complete':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), done: true } }
    case 'uncomplete':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), done: false } }
    case 'schedule-today':
      if (typeof action.taskId !== 'number' || typeof action.dueDate !== 'string') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), due_date: action.dueDate } }
    case 'remove-due-date':
      if (typeof action.taskId !== 'number') return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: { ...(action.taskData ?? {}), due_date: NULL_DATE } }
    case 'update-task':
      if (typeof action.taskId !== 'number' || !action.taskData) return { kind: 'skip' }
      return { kind: 'update', taskId: action.taskId, payload: action.taskData }
    default:
      return { kind: 'skip' }
  }
}
