import type { ApiResult, ProjectView, Task, TaskQueryParams } from './vikunja-types'

/**
 * Putting a freshly created task at the end of its project's list view (D-REN-7).
 *
 * Vikunja gives every new task half of the lowest position in the view, so a new task lands at the
 * top of the list; anchoring it at the end needs one position update per create. Everything else
 * that used to surround that update is remembered instead of asked for each time:
 *
 * - the id of the project's list view (from the query cache, or one `GET /views` the first time),
 * - the last position handed out (from the cached list, or one one-row query the first time), so
 *   the next create in the project is a single request,
 * - and the update runs in the background, so the create does not wait for it.
 *
 * What is remembered is dropped when the update fails (the view may be gone), when the project is
 * deleted, and when the account changes. Positions are only a convenience: a failed update leaves the
 * task where the server put it and never fails the create.
 */

/** Vikunja's own spacing between positions. */
export const POSITION_STEP = 2 ** 16

export interface PositionApi {
  fetchProjectViews(projectId: number): Promise<ApiResult<ProjectView[]>>
  fetchViewTasks(projectId: number, viewId: number, params: TaskQueryParams): Promise<ApiResult<Task[]>>
  updateTaskPosition(taskId: number, viewId: number, position: number): Promise<ApiResult<unknown>>
}

/** What the query cache already knows about a project's list; reading it costs nothing. */
export interface PositionHints {
  viewId?: number
  /** The highest position among the cached open tasks of the list view. */
  maxPosition?: number
}

interface ProjectEntry {
  viewId: number
  /** The last position handed out, or the highest one seen. */
  last: number
}

export interface NewTaskPlacer {
  /** Move `taskId` to the end of the project's list view. Never rejects; false when it could not. */
  placeAtEnd(projectId: number, taskId: number, hints?: PositionHints): Promise<boolean>
  /** A task was moved to `position` in `viewId` (a drag): the end of that list is at least there. */
  noteViewPosition(viewId: number, position: number): void
  /** Forget a project (deleted, or its views changed), or every project. */
  invalidate(projectId?: number): void
}

export function createNewTaskPlacer(api: PositionApi): NewTaskPlacer {
  const entries = new Map<number, ProjectEntry>()
  const resolving = new Map<number, Promise<ProjectEntry | null>>()

  async function lookUp(projectId: number, hints: PositionHints): Promise<ProjectEntry | null> {
    let viewId = hints.viewId
    if (viewId === undefined) {
      const views = await api.fetchProjectViews(projectId)
      if (!views.success) return null
      viewId = views.data.find((view) => view.view_kind === 'list')?.id
      // No list view (yet): not remembered, so a later create looks again.
      if (viewId === undefined) return null
    }
    let last = hints.maxPosition
    if (last === undefined) {
      // One row is enough to know where the end is.
      const top = await api.fetchViewTasks(projectId, viewId, {
        filter: 'done = false',
        sort_by: 'position',
        order_by: 'desc',
        page: 1,
        per_page: 1,
        keep_nested_subtasks: true,
      })
      if (!top.success) return null
      last = top.data[0]?.position ?? 0
    }
    const entry = { viewId, last }
    entries.set(projectId, entry)
    return entry
  }

  function resolveEntry(projectId: number, hints: PositionHints): Promise<ProjectEntry | null> {
    const known = entries.get(projectId)
    // The app's own cache has seen a different list view than the one remembered: the view changed.
    if (known && hints.viewId !== undefined && hints.viewId !== known.viewId) entries.delete(projectId)
    else if (known) return Promise.resolve(known)

    // Creates that overlap in one project share one look-up, then each takes the next position.
    const running = resolving.get(projectId)
    if (running) return running
    const started = lookUp(projectId, hints).finally(() => { resolving.delete(projectId) })
    resolving.set(projectId, started)
    return started
  }

  return {
    async placeAtEnd(projectId, taskId, hints = {}) {
      try {
        const entry = await resolveEntry(projectId, hints)
        if (!entry) return false
        // The cached list may know a later position than this module handed out (a drag, another create).
        if (hints.maxPosition !== undefined && hints.maxPosition > entry.last) entry.last = hints.maxPosition
        const position = entry.last + POSITION_STEP
        entry.last = position
        const result = await api.updateTaskPosition(taskId, entry.viewId, position)
        if (result.success) return true
        this.invalidate(projectId)
        return false
      } catch {
        this.invalidate(projectId)
        return false
      }
    },

    noteViewPosition(viewId, position) {
      for (const entry of entries.values()) {
        if (entry.viewId === viewId && position > entry.last) entry.last = position
      }
    },

    invalidate(projectId) {
      if (projectId === undefined) entries.clear()
      else entries.delete(projectId)
    },
  }
}

/** The list view id and highest position the query cache holds for a project. */
export function readPositionHints(
  cache: { getQueryData<T>(queryKey: readonly unknown[]): T | undefined },
  projectId: number
): PositionHints {
  const views = cache.getQueryData<ProjectView[]>(['project-views', projectId])
  const listView = views?.find((view) => view.view_kind === 'list')
  if (!listView) return {}
  const tasks = cache.getQueryData<Task[]>(['view-tasks', projectId, listView.id])
  if (!tasks || tasks.length === 0) return { viewId: listView.id }
  return { viewId: listView.id, maxPosition: tasks.reduce((max, task) => Math.max(max, task.position ?? 0), 0) }
}

/**
 * Start placing a task and return at once; `onDone` hears whether the position was set (the lists
 * refresh then, so the task shows up where it belongs).
 */
export function placeNewTaskInBackground(
  placer: NewTaskPlacer,
  projectId: number,
  taskId: number,
  hints: PositionHints,
  onDone?: (placed: boolean) => void
): void {
  void placer.placeAtEnd(projectId, taskId, hints).then((placed) => onDone?.(placed))
}
