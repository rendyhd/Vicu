import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY } from '@/hooks/use-app-config'
import {
  useUpdateTask,
  useAddLabel,
  useCompleteTask,
  useDeleteTask,
} from '@/hooks/use-task-mutations'
import { useSelectionStore } from '@/stores/selection-store'
import { confirmDelete } from '@/lib/confirm-bridge'
import { copySelectedTitles } from '@/lib/task-selection'
import { tomorrowAtMidnightISO, nextMondayAtMidnightISO } from '@/lib/date-utils'
import { NULL_DATE } from '@/lib/constants'
import type { Task, Label } from '@/lib/vikunja-types'

/**
 * Actions for the right-click context menu, applied to one OR many tasks.
 * Every field change goes through a full `{ ...task }` spread to dodge Vikunja's
 * Go zero-value wipe (see the note in src/main/api-client.ts). Bulk operations
 * loop per task — Vikunja has no batch endpoint — letting each mutation's own
 * optimistic update + invalidation reconcile the caches (React Query dedupes the
 * concurrent refetches). The `record*` helpers persist the most recent
 * project/label to config so the menu can offer one-click "Move to last" /
 * "Apply last"; they invalidate the app-config query because its staleTime is
 * Infinity and would otherwise serve the old value.
 */
export function useTaskActions(tasks: Task[]) {
  const qc = useQueryClient()
  const updateTask = useUpdateTask()
  const addLabel = useAddLabel()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  const patch = useCallback(
    (changes: Partial<Task>) => {
      tasks.forEach((t) => {
        updateTask.mutate({ id: t.id, task: { ...t, ...changes } })
      })
    },
    [tasks, updateTask]
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
      tasks.forEach((t) => {
        if (t.project_id === projectId) return
        updateTask.mutate({ id: t.id, task: { ...t, project_id: projectId } })
      })
      // Moved tasks leave the current view — drop the now-orphaned selection
      // (parity with drag-to-project).
      clearSelection()
    },
    [tasks, updateTask, clearSelection]
  )

  const applyLabel = useCallback(
    (labelId: number) => {
      tasks.forEach((t) => {
        if (!(t.labels ?? []).some((l) => l.id === labelId)) {
          addLabel.mutate({ taskId: t.id, labelId })
        }
      })
    },
    [tasks, addLabel]
  )

  const completeAll = useCallback(() => {
    tasks.forEach((t) => {
      if (!t.done) completeTask.mutate(t)
    })
    clearSelection()
  }, [tasks, completeTask, clearSelection])

  const deleteAll = useCallback(async () => {
    if (tasks.length === 0) return
    const message =
      tasks.length > 1
        ? `Delete ${tasks.length} tasks? This cannot be undone.`
        : 'Delete this task? This cannot be undone.'
    const ok = await confirmDelete(message)
    if (!ok) return
    tasks.forEach((t) => deleteTask.mutate(t.id))
    clearSelection()
  }, [tasks, deleteTask, clearSelection])

  const copyAll = useCallback(
    () => copySelectedTitles(qc, new Set(tasks.map((t) => t.id))),
    [qc, tasks]
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
    completeAll,
    deleteAll,
    copyAll,
    recordLastProject,
    recordLastLabel,
  }
}
