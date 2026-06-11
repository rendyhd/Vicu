import type { PendingAction } from './cache'

const NULL_DATE = '0001-01-01T00:00:00Z'

/**
 * Project queued offline actions onto a cached task snapshot so the offline
 * Quick View reflects what the user already did: completes hide rows, date
 * actions and updates rewrite rows, creates append placeholder rows.
 */
export function overlayPendingActions(
  cachedTasks: unknown[],
  actions: PendingAction[]
): unknown[] {
  const completedIds = new Set(
    actions.filter((a) => a.type === 'complete').map((a) => String(a.taskId))
  )

  let tasks = cachedTasks.filter((t) => !completedIds.has(String((t as { id?: unknown }).id)))

  for (const action of actions) {
    if (action.taskId === undefined) continue
    const idx = tasks.findIndex((t) => String((t as { id?: unknown }).id) === String(action.taskId))
    if (idx === -1) continue
    const row = tasks[idx] as Record<string, unknown>
    if (action.type === 'schedule-today' || action.type === 'remove-due-date') {
      tasks = tasks.slice()
      tasks[idx] = { ...row, due_date: action.dueDate ?? NULL_DATE }
    } else if (action.type === 'update-task' && action.taskData) {
      tasks = tasks.slice()
      tasks[idx] = { ...row, ...action.taskData }
    }
  }

  const creates = actions
    .filter((a) => a.type === 'create')
    .map((a) => ({
      id: `pending_${a.id}`,
      title: a.title,
      description: a.description || '',
      due_date: a.dueDate || NULL_DATE,
      priority: 0,
      done: false,
      created: a.createdAt,
      updated: a.createdAt,
    }))

  return [...tasks, ...creates]
}
