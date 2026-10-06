import type { ApiResult } from '../api-result'

interface ProjectViewSummary {
  id: number
  view_kind: string
}

interface PositionSortDeps {
  fetchViews(projectId: number): Promise<ApiResult<unknown[]>>
  fetchViewTasks(projectId: number, viewId: number, params: Record<string, unknown>): Promise<ApiResult<unknown[]>>
}

/**
 * Quick View's "position" sort is only defined per project view, so fetch each
 * project's list view and concatenate them in project order.
 *
 * `params` carries no `page`, so every view is paginated to its last page by the
 * API client (per_page is capped at the server maximum of 1000). A failed request
 * fails the whole fetch: silently skipping a project would show a list that looks
 * complete but is not.
 */
export async function fetchPositionSortedTasks(
  projectIds: number[],
  params: Record<string, unknown>,
  deps: PositionSortDeps,
): Promise<ApiResult<unknown[]>> {
  const all: unknown[] = []
  for (const projectId of projectIds) {
    const views = await deps.fetchViews(projectId)
    if (!views.success) return views
    const list = views.data as ProjectViewSummary[]
    const listView = list.find((view) => view.view_kind === 'list') ?? list[0]
    if (!listView) continue

    const tasks = await deps.fetchViewTasks(projectId, listView.id, params)
    if (!tasks.success) return tasks
    all.push(...tasks.data)
  }
  return { success: true, data: all }
}
