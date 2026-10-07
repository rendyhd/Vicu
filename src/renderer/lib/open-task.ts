import type { ApiResult, Task } from './vikunja-types'
import { useSelectionStore } from '@/stores/selection-store'

// "Open this task in the main window" (a clicked task reminder, a daily summary notification,
// Quick View's "open in app"). The app has no page for a single task: a task is a row in a list
// that expands to its editor. So this goes to the list the task is in and asks that row to
// expand; the row does it when it appears (see `pendingOpenTaskId` in the selection store).

export type TaskRoute =
  | { to: '/inbox' }
  | { to: '/logbook' }
  | { to: '/project/$projectId'; params: { projectId: string } }

/** The list a task is shown in: the logbook once it is done, the inbox for the inbox project, else its project. */
export function routeForTask(task: Pick<Task, 'project_id' | 'done'>, inboxProjectId: number): TaskRoute {
  if (task.done) return { to: '/logbook' }
  if (inboxProjectId > 0 && task.project_id === inboxProjectId) return { to: '/inbox' }
  return { to: '/project/$projectId', params: { projectId: String(task.project_id) } }
}

export interface OpenTaskDeps {
  fetchTask(id: number): Promise<ApiResult<Pick<Task, 'id' | 'project_id' | 'done'>>>
  inboxProjectId(): Promise<number>
  navigate(route: TaskRoute): void
  notify(message: string): void
}

/** How long a request waits for its row before it is dropped (the task may not be in that list). */
export const OPEN_REQUEST_TTL_MS = 10_000

export async function openTaskInApp(deps: OpenTaskDeps, taskId: number): Promise<void> {
  if (!Number.isInteger(taskId) || taskId <= 0) return

  const result = await deps.fetchTask(taskId)
  if (!result.success) {
    deps.notify(`Could not open the task: ${result.error}`)
    return
  }

  const inboxProjectId = await deps.inboxProjectId().catch(() => 0)
  const { requestOpenTask, clearOpenRequest } = useSelectionStore.getState()
  requestOpenTask(taskId)
  deps.navigate(routeForTask(result.data, inboxProjectId))
  setTimeout(() => clearOpenRequest(taskId), OPEN_REQUEST_TTL_MS)
}
