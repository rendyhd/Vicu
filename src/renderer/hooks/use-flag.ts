import { useCallback } from 'react'
import { useUpdateTask } from './use-task-mutations'
import type { Task } from '@/lib/vikunja-types'

/**
 * Pro's flag (cross-app semantics 21.4): Vikunja's per-user `is_favorite`, written alone. Several
 * tasks: flags them all unless all are flagged, then clears them all. Each write goes through the
 * offline-aware update path.
 */
export function useToggleFlags(): (tasks: readonly Task[]) => void {
  const update = useUpdateTask()
  return useCallback(
    (tasks) => {
      const open = tasks.filter((task) => !task.done || task.is_favorite)
      if (open.length === 0) return
      const flag = open.some((task) => task.is_favorite !== true)
      for (const task of open) {
        if ((task.is_favorite === true) === flag) continue
        update.mutate({ id: task.id, changes: { is_favorite: flag }, original: task })
      }
    },
    [update],
  )
}

/** The flag's menu text for these tasks. */
export function flagActionLabel(tasks: readonly Pick<Task, 'is_favorite'>[]): string {
  return tasks.length > 0 && tasks.every((task) => task.is_favorite === true) ? 'Remove flag' : 'Flag'
}
