import type { TaskQueryParams } from './vikunja-types'

// Task list requests also ask for `comment_count` and `is_unread` (cross-app semantics 9.4): comments
// are on every task, and the two expands cost no extra request.

/** The params of a task list request, with the comment signals. */
export function withCollabSignals(params: TaskQueryParams): TaskQueryParams {
  return { ...params, collab_signals: true }
}
