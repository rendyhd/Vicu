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
import { dueNextWeek, dueToday, dueTomorrow } from '@/lib/due-dates'
import { NULL_DATE } from '@/lib/constants'
import type { Task, Label } from '@/lib/vikunja-types'
import { taskDescendants, unfinishedDescendants } from '@/lib/task-hierarchy'

/**
 * Actions for the right-click context menu, applied to one OR many tasks.
 * Each mutation carries only the changed fields plus the cached task it was
 * made against; `useUpdateTask` diffs them into a minimal v2 merge patch and
 * uses the cached task to populate the destination cache optimistically.
 * Bulk operations loop per task, letting each mutation reconcile its caches.
 * The `record*` helpers persist the most recent project/label for one-click reuse.
 */
export function useTaskActions(tasks: Task[], options: { returnFocusTo?: HTMLElement | null } = {}) {
  const { returnFocusTo } = options
  const qc = useQueryClient()
  const updateTask = useUpdateTask()
  const addLabel = useAddLabel()
  const completeTask = useCompleteTask()
  const deleteTask = useDeleteTask()
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  const patch = useCallback(
    (changes: Partial<Task>) => {
      tasks.forEach((t) => {
        updateTask.mutate({ id: t.id, changes, original: t })
      })
    },
    [tasks, updateTask]
  )

  const setDueToday = useCallback(() => patch({ due_date: dueToday() }), [patch])

  const setUrgentPriority = useCallback(() => patch({ priority: 4 }), [patch])

  const setDueDateIso = useCallback((iso: string) => patch({ due_date: iso }), [patch])

  const postponeTomorrow = useCallback(
    () => patch({ due_date: dueTomorrow() }),
    [patch]
  )

  const postponeNextMonday = useCallback(
    () => patch({ due_date: dueNextWeek() }),
    [patch]
  )

  const clearDate = useCallback(() => patch({ due_date: NULL_DATE }), [patch])

  const setPriority = useCallback((priority: number) => patch({ priority }), [patch])

  const clearPriority = useCallback(() => patch({ priority: 0 }), [patch])

  const moveToProject = useCallback(
    (projectId: number) => {
      tasks.forEach((t) => {
        if (t.project_id === projectId) return
        updateTask.mutate({ id: t.id, changes: { project_id: projectId }, original: t })
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
        { force: true, confirmLabel: 'Complete all', destructive: false, returnFocusTo },
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
  }, [tasks, completeTask, clearSelection, returnFocusTo])

  const deleteAll = useCallback(async () => {
    if (tasks.length === 0) return
    const structuralTask = tasks.length === 1 && taskDescendants(tasks[0]).length > 0
      ? tasks[0]
      : null
    if (structuralTask) {
      const count = taskDescendants(structuralTask).length
      const deleteChildren = await confirmDelete(
        `Delete this task and ${count} ${count === 1 ? 'subtask' : 'subtasks'}?`,
        { force: true, confirmLabel: 'Delete all', destructive: true, returnFocusTo },
      )
      if (deleteChildren) {
        deleteTask.mutate({ task: structuralTask, deleteSubtasks: true })
        clearSelection()
        return
      }
      const keepChildren = await confirmDelete(
        `Keep ${count === 1 ? 'the subtask' : 'the subtasks'} as standalone tasks and delete only the parent?`,
        { force: true, confirmLabel: 'Keep subtasks', destructive: false, returnFocusTo },
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
        { force: true, confirmLabel: 'Close', destructive: false, returnFocusTo },
      )
      return
    }
    const message =
      tasks.length > 1
        ? `Delete ${tasks.length} tasks? This cannot be undone.`
        : 'Delete this task? This cannot be undone.'
    const ok = await confirmDelete(message, { returnFocusTo })
    if (!ok) return
    tasks.forEach((t) => deleteTask.mutate({ task: t }))
    clearSelection()
  }, [tasks, deleteTask, clearSelection, returnFocusTo])

  const copyAll = useCallback(
    () => copySelectedTitles(qc, new Set(tasks.map((t) => t.id))),
    [qc, tasks]
  )

  const recordLastProject = useCallback(
    async (projectId: number) => {
      await api.saveConfigPatch({ last_used_project_id: projectId })
      qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
    },
    [qc]
  )

  const recordLastLabel = useCallback(
    async (label: Label) => {
      await api.saveConfigPatch({ last_used_label_id: label.id })
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
