import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useTasks } from '@/hooks/use-tasks'
import { openCountsByProject, projectProgress, type ProjectProgress } from '@/lib/project-progress'
import type { TaskQueryParams } from '@/lib/vikunja-types'

// Every open task, subtasks included, so the open side counts the same tasks the server's done
// count does (its `total` includes subtasks). One listing shared by the Inbox count and every ring.
const OPEN_TASKS: TaskQueryParams = { filter: 'done = false', keep_nested_subtasks: true }

/**
 * Open tasks per project id, or null until they are loaded. The query is the sidebar's own (its key
 * differs from Anytime's, which hides nested subtasks); completions and edits update it in place
 * like every other task list.
 */
export function useOpenTaskCounts(): ReadonlyMap<number, number> | null {
  const { data, isSuccess } = useTasks(OPEN_TASKS)
  return useMemo(() => (isSuccess ? openCountsByProject(data) : null), [data, isSuccess])
}

/**
 * How many tasks of a project are done, carriers excluded: one request in the main process
 * (cached there for ten minutes, refreshed when a task of the project changes). `enabled` is false
 * for rows nobody can see, so a collapsed branch costs nothing.
 */
export function useProjectDoneCount(projectId: number, enabled = true): number | undefined {
  const { data } = useQuery({
    queryKey: ['project-counts', projectId, 'done'],
    queryFn: async () => {
      const result = await api.countProjectTasks(projectId, true)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled,
    staleTime: 60_000,
    // A failed count only means no ring for now; the next refresh tries again.
    retry: false,
    meta: { silent: true },
  })
  return data
}

/** The ring of one project, or null while a count is unknown or the project is empty. */
export function useProjectProgress(
  projectId: number,
  openCounts: ReadonlyMap<number, number> | null,
  enabled = true,
): ProjectProgress | null {
  const done = useProjectDoneCount(projectId, enabled)
  return useMemo(
    () => (openCounts ? projectProgress(done, openCounts.get(projectId) ?? 0) : null),
    [done, openCounts, projectId],
  )
}
