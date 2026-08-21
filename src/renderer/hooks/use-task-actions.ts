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
import { copySelectedTitles, isTaskNestedInCurrentList } from '@/lib/task-selection'
import { tomorrowAtMidnightISO, nextMondayAtMidnightISO } from '@/lib/date-utils'
import { NULL_DATE } from '@/lib/constants'
import type { Task, Label } from '@/lib/vikunja-types'
import { taskDescendants, unfinishedDescendants } from '@/lib/task-hierarchy'

/**
 * Actions for the right-click context menu, applied to one OR many tasks.
 * Full task data is kept in mutation inputs so optimistic cross-project moves
 * can populate the destination cache immediately; the main-process API client
 * filters it into a writable v2 merge patch. Bulk operations loop per task,
 * letting each mutation reconcile its caches. The `record*` helpers persist the
 * most recent project/label for one-click reuse.
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

  const completeAll = useCallback(async () => {
    const targets = tasks.filter((task) => !task.done)
    const descendantCount = new Set(
      targets.flatMap((task) => unfinishedDescendants(task).map((child) => child.id)),
    ).size
    if (descendantCount > 0) {
      const ok = await confirmDelete(
        `Complete ${targets.length} ${targets.length === 1 ? 'task' : 'tasks'} and ${descendantCount} unfinished ${descendantCount === 1 ? 'subtask' : 'subtasks'}?`,
        { force: true, confirmLabel: 'Complete all', destructive: false },
      )
      if (!ok) return
    }
    targets.forEach((t) => {
      if (!t.done) {
        completeTask.mutate(
          isTaskNestedInCurrentList(t) ? { task: t, suppressTopLevelUndo: true } : t,
        )
      }
    })
    clearSelection()
  }, [tasks, completeTask, clearSelection])

  const deleteAll = useCallback(async () => {
    if (tasks.length === 0) return
    const structuralTask = tasks.length === 1 && taskDescendants(tasks[0]).length > 0
      ? tasks[0]
      : null
    if (structuralTask) {
      const count = taskDescendants(structuralTask).length
      const deleteChildren = await confirmDelete(
        `Delete this task and ${count} ${count === 1 ? 'subtask' : 'subtasks'}?`,
        { force: true, confirmLabel: 'Delete all', destructive: true },
      )
      if (deleteChildren) {
        deleteTask.mutate({ task: structuralTask, deleteSubtasks: true })
        clearSelection()
        return
      }
      const keepChildren = await confirmDelete(
        `Keep ${count === 1 ? 'the subtask' : 'the subtasks'} as standalone tasks and delete only the parent?`,
        { force: true, confirmLabel: 'Keep subtasks', destructive: false },
      )
      if (keepChildren) {
        deleteTask.mutate({ task: structuralTask, deleteSubtasks: false })
        clearSelection()
      }
      return
    }
    if (tasks.some((task) => taskDescendants(task).length > 0)) {
      await confirmDelete(
        'This selection includes a parent task. Open that parent to choose whether its subtasks should be deleted or kept.',
        { force: true, confirmLabel: 'Close', destructive: false },
      )
      return
    }
    const message =
      tasks.length > 1
        ? `Delete ${tasks.length} tasks? This cannot be undone.`
        : 'Delete this task? This cannot be undone.'
    const ok = await confirmDelete(message)
    if (!ok) return
    tasks.forEach((t) => deleteTask.mutate({ task: t }))
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
