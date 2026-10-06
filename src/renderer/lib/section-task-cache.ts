import { sortProjectTasks } from '@/lib/task-sort'
import type { Task } from '@/lib/vikunja-types'

/**
 * Raw data stored under the `section-tasks` query key.
 *
 * This intentionally differs from SectionData: the query cache is a flat list
 * keyed by descendant project ID, while SectionData is the recursive view model
 * built from these entries by useProjectSections.
 */
export interface SectionTaskCacheEntry {
  id: number
  tasks: Task[]
  viewId: number | undefined
}

/**
 * Apply a task update to every cached descendant-project entry.
 *
 * Parent-project tasks are not present in this cache. Cross-project moves may
 * remove a task from one descendant entry and add it to another. `changes` is a
 * partial update; `original` supplies the rest of the task when a move adds it
 * to an entry that did not hold it yet.
 */
export function updateSectionTaskCache(
  entries: SectionTaskCacheEntry[] | undefined,
  id: number,
  changes: Partial<Task>,
  original?: Task
): SectionTaskCacheEntry[] | undefined {
  if (!entries) return entries

  const current = entries.flatMap((entry) => entry.tasks).find((candidate) => candidate.id === id)
  const merged: Task | null = current
    ? ({ ...current, ...changes } as Task)
    : original
      ? ({ ...original, ...changes } as Task)
      : (changes.title !== undefined ? ({ ...changes, id } as Task) : null)

  if (!merged || merged.project_id === undefined) return entries

  let changed = false
  const next = entries.map((entry) => {
    const hasTask = entry.tasks.some((candidate) => candidate.id === id)

    if (hasTask && entry.id !== merged.project_id) {
      changed = true
      return {
        ...entry,
        tasks: entry.tasks.filter((candidate) => candidate.id !== id),
      }
    }

    if (hasTask) {
      changed = true
      return {
        ...entry,
        tasks: sortProjectTasks(
          entry.tasks.map((candidate) => (candidate.id === id ? merged : candidate))
        ),
      }
    }

    if (entry.id === merged.project_id) {
      changed = true
      return {
        ...entry,
        tasks: sortProjectTasks([...entry.tasks, merged]),
      }
    }

    return entry
  })

  return changed ? next : entries
}
