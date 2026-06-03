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
 * The completed-tasks store records the single `path` whose undo window should
 * keep the task visible. On that path we keep it (strikethrough); on any other
 * path a done task is a leaked optimistic write, so drop it. `done: false`
 * store entries are tasks that were just *un*completed and are active again —
 * never evict those.
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
  if (completed.size === 0) return tasks
  const filtered = tasks.filter((t) => {
    const entry = completed.get(t.id)
    return !entry || entry.path === pathname || !entry.task.done
  })
  return filtered.length === tasks.length ? tasks : filtered
}
