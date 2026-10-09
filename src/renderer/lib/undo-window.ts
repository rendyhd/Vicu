import { hasVicuMetadataMarker } from './metadata-tasks'
import { sortProjectTasks } from './task-sort'
import type { Task } from './vikunja-types'
import type { CompletedTaskEntry } from '@/stores/completed-tasks-store'

/**
 * Remove tasks that were optimistically completed on a DIFFERENT path.
 *
 * When a task is completed, `useCompleteTask` marks it `done: true` in every
 * cached list it appears in — including a subproject task that lives both in
 * its own project's `view-tasks` cache AND in its parent project's
 * `section-tasks` cache. Because completion deliberately skips invalidation,
 * that leaked `done: true` lingers (staleTime 30s) and the task renders as
 * completed in views where it doesn't belong.
 *
 * These views only ever query `done = false`, so the server never returns a
 * done task — any `done: true` row is therefore a leaked optimistic write. Keep
 * such a row ONLY while it is the active undo window for the CURRENT path (the
 * completed-tasks store records that single path); drop it everywhere else.
 * That includes the case where the store has already been cleared on navigation
 * and the row has NO entry at all — without this it lingers until a refetch
 * happens to win (potentially never, e.g. offline). Active (`done: false`) rows
 * are always kept, including tasks just *un*completed and active again.
 *
 * Only safe for views that always query `done = false` (project list views and
 * section views). Do NOT use for the logbook, which legitimately shows done
 * tasks completed elsewhere.
 *
 * Returns the original array reference when nothing is evicted so callers can
 * cheaply detect "no change".
 */
export function evictForeignCompletions(
  tasks: Task[],
  completed: Map<number, CompletedTaskEntry>,
  pathname: string
): Task[] {
  const filtered = tasks.filter((t) => {
    // Active rows are always legitimate — the view filters done = false.
    if (!t.done) return true
    // A done row is a leaked optimistic completion. Keep it only as the active
    // undo window for THIS path; drop it on any other path, and also when no
    // store entry survives (cleared on navigation) rather than waiting on a
    // refetch that may never win.
    const entry = completed.get(t.id)
    return entry !== undefined && entry.path === pathname
  })
  return filtered.length === tasks.length ? tasks : filtered
}

/** True when a task query filter asks for open tasks only: `done = false`, alone or in a conjunction. */
export function asksForOpenTasksOnly(filter: string | undefined): boolean {
  return /(^|&&\s*)done\s*=\s*false\s*(&&|$)/.test(filter ?? '')
}

/**
 * The leaked optimistic completions of an open-only smart list (a query with `done = false`: Today,
 * Upcoming, Anytime, Tag, custom lists, Inbox). A completion marks the task `done: true` in every
 * cached list and skips the refetch, so the row stays until the completion hold ends: while the
 * completed-tasks store holds it for THIS path the row is kept, afterwards it is dropped. A subtask
 * the parent's completion finished along with it (`autoCompletedSubtasks`) is kept as long as the
 * parent is. Returns `tasks` itself when nothing is dropped.
 */
export function dropReleasedCompletions(
  tasks: Task[],
  completed: Map<number, CompletedTaskEntry>,
  pathname: string
): Task[] {
  const keep = new Set<number>()
  for (const entry of completed.values()) {
    if (entry.path !== pathname) continue
    keep.add(entry.task.id)
    for (const child of entry.autoCompletedSubtasks ?? []) keep.add(child.id)
  }
  const visible = tasks.filter((t) => !t.done || keep.has(t.id))
  return visible.length === tasks.length ? tasks : visible
}

/**
 * Apply the undo window to a project page's own task list. The top list belongs
 * only to the current project; child-project tasks are rendered by
 * `mergeSectionUndoWindow`. Without the project_id guard here, completing a
 * child task from a section while still on the parent route re-adds that child
 * task to the parent's top list as a same-path undo extra.
 */
export function mergeProjectUndoWindow(
  tasks: Task[],
  completed: Map<number, CompletedTaskEntry>,
  pathname: string,
  projectId: number | undefined
): Task[] {
  const visible = evictForeignCompletions(tasks, completed, pathname).filter(
    (t) => projectId == null || t.project_id === projectId
  )
  const serverIds = new Set(visible.map((t) => t.id))
  const extras = Array.from(completed.values())
    .filter(
      (entry) =>
        entry.path === pathname &&
        !entry.suppressTopLevelUndo &&
        (projectId == null || entry.task.project_id === projectId) &&
        !serverIds.has(entry.task.id)
    )
    .map((entry) => entry.task)

  if (visible === tasks && extras.length === 0) return tasks
  return sortProjectTasks([...visible, ...extras])
}

/**
 * Apply the undo window to a parent project's subproject sections. For each
 * section: drop leaked optimistic completions (see `evictForeignCompletions`)
 * and re-add any task whose active undo window belongs to THIS path — the
 * server, queried `done = false`, no longer returns it, so it must be merged
 * back to linger with strikethrough. Mirrors the per-list merge in
 * `useProjectTasks`.
 *
 * Unlike the previous inline version, this evicts even when the store is empty
 * (the post-navigation state), so a leaked completion can't survive in a
 * section's cache until a refetch happens to win. Returns the original
 * `sections` reference when nothing changed so callers can skip re-renders.
 */
export function mergeSectionUndoWindow<
  S extends { tasks: Task[]; project: { id: number } },
>(sections: S[], completed: Map<number, CompletedTaskEntry>, pathname: string): S[] {
  const samePath = Array.from(completed.values()).filter(
    (e) => e.path === pathname && !e.suppressTopLevelUndo,
  )
  let changed = false
  const next = sections.map((section) => {
    const visible = evictForeignCompletions(section.tasks, completed, pathname)
    const serverIds = new Set(visible.map((t) => t.id))
    const extras = samePath
      .filter((e) => e.task.project_id === section.project.id && !serverIds.has(e.task.id))
      .map((e) => e.task)
    if (visible === section.tasks && extras.length === 0) return section
    changed = true
    return { ...section, tasks: sortProjectTasks([...visible, ...extras]) }
  })
  return changed ? next : sections
}

/**
 * Apply the undo window to a smart list (Today, Upcoming, Anytime, Tag, Logbook, search): the
 * tasks toggled on THIS path that the server no longer returns (completed ones leave an open list,
 * reopened ones leave the Logbook) are merged back, so they stay visible until the user navigates away.
 * Implementation-detail tasks never show. Returns `tasks` itself when nothing is added.
 *
 * `previous` is the list this function returned last time. A task that was in it goes back right
 * after the nearest row that was above it (a refetch must not move a held row out from under the
 * pointer: the pointer leaving is what ends the hold); a task that was not in it is appended.
 */
export function mergeSmartListUndoWindow(
  tasks: Task[],
  completed: Map<number, CompletedTaskEntry>,
  pathname: string,
  previous: readonly Task[] = []
): Task[] {
  const serverIds = new Set(tasks.map((t) => t.id))
  const extras = Array.from(completed.values())
    .filter(
      (entry) =>
        entry.path === pathname &&
        !entry.suppressTopLevelUndo &&
        !serverIds.has(entry.task.id) &&
        !hasVicuMetadataMarker(entry.task.description)
    )
    .map((entry) => entry.task)
  if (extras.length === 0) return tasks

  const previousIndex = new Map(previous.map((t, i) => [t.id, i]))
  const placed = extras.filter((t) => previousIndex.has(t.id)).sort((a, b) => previousIndex.get(a.id)! - previousIndex.get(b.id)!)
  const appended = extras.filter((t) => !previousIndex.has(t.id))
  const merged = [...tasks]
  for (const extra of placed) {
    // Walk up the previous list to the nearest row that is in the merged list, and go after it.
    let at = 0
    for (let i = previousIndex.get(extra.id)! - 1; i >= 0; i--) {
      const above = merged.findIndex((t) => t.id === previous[i].id)
      if (above >= 0) {
        at = above + 1
        break
      }
    }
    merged.splice(at, 0, extra)
  }
  return [...merged, ...appended]
}
