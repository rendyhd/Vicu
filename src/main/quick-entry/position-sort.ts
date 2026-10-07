import type { ApiResult } from '../api-result'
import { mapLimited } from '../map-limited'
import type { TtlCache } from '../ttl-cache'

interface ProjectViewSummary {
  id: number
  view_kind: string
}

interface PositionSortDeps {
  fetchViews(projectId: number): Promise<ApiResult<unknown[]>>
  fetchViewTasks(projectId: number, viewId: number, params: Record<string, unknown>): Promise<ApiResult<unknown[]>>
}

export interface PositionSortOptions {
  /** Projects read at the same time. */
  concurrency?: number
  /** The list view id of each project, remembered briefly so a refresh does not read the views again. */
  viewCache?: TtlCache<number, number>
}

/** Few enough not to hammer a small self-hosted server, enough to cut the wait for a long project list. */
export const POSITION_SORT_CONCURRENCY = 4

/** The id of the list view (or the first view) of a project; null when it has none. */
async function resolveListView(projectId: number, deps: PositionSortDeps): Promise<ApiResult<number | null>> {
  const views = await deps.fetchViews(projectId)
  if (!views.success) return views
  const list = views.data as ProjectViewSummary[]
  const listView = list.find((view) => view.view_kind === 'list') ?? list[0]
  return { success: true, data: listView ? listView.id : null }
}

/**
 * Quick View's "position" sort is only defined per project view, so fetch each project's list view
 * and concatenate them in project order.
 *
 * The projects are read a few at a time (D-IPC-6) and the view ids are remembered for a while, so a
 * refresh is one request per project instead of two in a row. A remembered view that no longer
 * works (deleted, or the server changed) is looked up again once.
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
  { concurrency = POSITION_SORT_CONCURRENCY, viewCache }: PositionSortOptions = {},
): Promise<ApiResult<unknown[]>> {
  let failed = false

  const readProject = async (projectId: number): Promise<ApiResult<unknown[]>> => {
    // Another project already failed: the whole fetch fails, so do not start more requests.
    if (failed) return { success: true, data: [] }

    let viewId = viewCache?.get(projectId)
    const wasCached = viewId !== undefined
    if (viewId === undefined) {
      const resolved = await resolveListView(projectId, deps)
      if (!resolved.success) return resolved
      if (resolved.data === null) return { success: true, data: [] }
      viewId = resolved.data
      viewCache?.set(projectId, viewId)
    }

    let tasks = await deps.fetchViewTasks(projectId, viewId, params)
    if (!tasks.success && wasCached) {
      // The remembered view may be gone: ask again, once.
      viewCache?.delete(projectId)
      const resolved = await resolveListView(projectId, deps)
      if (!resolved.success) return resolved
      if (resolved.data === null) return { success: true, data: [] }
      viewCache?.set(projectId, resolved.data)
      tasks = await deps.fetchViewTasks(projectId, resolved.data, params)
    }
    return tasks
  }

  const results = await mapLimited(projectIds, concurrency, async (projectId) => {
    const result = await readProject(projectId)
    if (!result.success) failed = true
    return result
  })

  const all: unknown[] = []
  for (const result of results) {
    // The first failure in project order, as before.
    if (!result.success) return result
    all.push(...result.data)
  }
  return { success: true, data: all }
}
