import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY } from '@/hooks/use-app-config'
import { useUpdateTask, useAddLabel } from '@/hooks/use-task-mutations'
import { tomorrowAtMidnightISO, nextMondayAtMidnightISO } from '@/lib/date-utils'
import { NULL_DATE } from '@/lib/constants'
import type { Task, Label } from '@/lib/vikunja-types'

/**
 * Task actions for the right-click context menu. Every field change goes through
 * a full `{ ...task }` spread to dodge Vikunja's Go zero-value wipe (see the note
 * in src/main/api-client.ts). The `record*` helpers persist the most recent
 * project/label to config so the menu can offer one-click "Move to last" /
 * "Apply last" — they invalidate the app-config query because its staleTime is
 * Infinity and would otherwise serve the old value.
 */
export function useTaskActions(task: Task) {
  const qc = useQueryClient()
  const updateTask = useUpdateTask()
  const addLabel = useAddLabel()

  const patch = useCallback(
    (changes: Partial<Task>) => {
      updateTask.mutate({ id: task.id, task: { ...task, ...changes } })
    },
    [task, updateTask]
  )

  const setDueToday = useCallback(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    patch({ due_date: d.toISOString() })
  }, [patch])

  const setUrgentPriority = useCallback(() => patch({ priority: 4 }), [patch])

  const setDueDateIso = useCallback((iso: string) => patch({ due_date: iso }), [patch])

  const postponeTomorrow = useCallback(
    () => patch({ due_date: tomorrowAtMidnightISO() }),
    [patch]
  )

  const postponeNextMonday = useCallback(
    () => patch({ due_date: nextMondayAtMidnightISO() }),
    [patch]
  )

  const clearDate = useCallback(() => patch({ due_date: NULL_DATE }), [patch])

  const setPriority = useCallback((priority: number) => patch({ priority }), [patch])

  const clearPriority = useCallback(() => patch({ priority: 0 }), [patch])

  const moveToProject = useCallback(
    (projectId: number) => {
      if (projectId === task.project_id) return
      patch({ project_id: projectId })
    },
    [task.project_id, patch]
  )

  const applyLabel = useCallback(
    (labelId: number) => {
      addLabel.mutate({ taskId: task.id, labelId })
    },
    [task.id, addLabel]
  )

  const recordLastProject = useCallback(
    async (projectId: number) => {
      const cfg = await api.getConfig()
      if (!cfg) return
      await api.saveConfig({ ...cfg, last_used_project_id: projectId })
      qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
    },
    [qc]
  )

  const recordLastLabel = useCallback(
    async (label: Label) => {
      const cfg = await api.getConfig()
      if (!cfg) return
      await api.saveConfig({ ...cfg, last_used_label_id: label.id })
      qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
    },
    [qc]
  )

  return {
    setDueToday,
    setUrgentPriority,
    setDueDateIso,
    postponeTomorrow,
    postponeNextMonday,
    clearDate,
    setPriority,
    clearPriority,
    moveToProject,
    applyLabel,
    recordLastProject,
    recordLastLabel,
  }
}
