import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { duplicateMessage, duplicateTask, duplicationRoots, type DuplicateResult } from '@/lib/duplicate-task'
import { isTempTaskId } from '@/lib/pending-cache'
import { taskDescendants } from '@/lib/task-hierarchy'
import { refreshTasks } from '@/lib/task-refresh'
import type { Task } from '@/lib/vikunja-types'
import { UNDO_TOAST_MS, useToastStore, type ToastAction } from '@/stores/toast-store'
import { useToggleAssignee } from './use-assignee-mutations'
import { useOpenTask } from './use-open-task'
import { useProjectAccessMap } from './use-project-access'
import { useAddLabel, useCreateTask, useDeleteTask } from './use-task-mutations'

/** The task as the server has it now (labels, reminders, assignees, subtasks), or the cached copy offline. */
async function fullTask(task: Task): Promise<Task> {
  const result = await api.fetchTaskById(task.id)
  return result.success ? result.data : task
}

/**
 * Duplicate (docs/cross-app-semantics-v1.md section 15) for the context menu and the card's More
 * menu: each task once, a selected subtask only with its selected parent, through the composer's
 * create path. Says what was made and what could not be copied, with Open for a single copy and
 * Undo, which deletes every task the duplicate made (as on the phone); returns the copies.
 */
export function useDuplicateTasks(): (tasks: readonly Task[]) => Promise<Task[]> {
  const qc = useQueryClient()
  const createTask = useCreateTask()
  const deleteTask = useDeleteTask()
  const addLabel = useAddLabel({ silent: true })
  const toggleAssignee = useToggleAssignee()
  const access = useProjectAccessMap()
  const openTask = useOpenTask()

  return useCallback(async (tasks) => {
    const results: DuplicateResult[] = []
    const problems: string[] = []
    for (const task of duplicationRoots(tasks, (t) => taskDescendants(t).map((d) => d.id))) {
      try {
        const result = await duplicateTask(await fullTask(task), {
          createTask: (projectId, payload, labels) => createTask.mutateAsync({
            projectId,
            task: payload,
            extras: { labels: labels.map((l) => ({ id: l.id, title: l.title })), displayLabels: labels },
          }),
          addLabel: (copy, label) => addLabel.mutateAsync({ taskId: copy.id, labelId: label.id }),
          assign: (copy, person) => toggleAssignee.mutateAsync({ task: copy, person, assign: true }),
          createSubtaskRelation: async (parentId, childId) => {
            const res = await api.createTaskRelation(parentId, childId, 'subtask')
            if (!res.success) throw new Error(res.error)
          },
          subtasksOf: (original) => Promise.all((original.related_tasks?.subtask ?? []).map(fullTask)),
          isShared: (projectId) => access.get(projectId)?.shared === true,
        })
        results.push(result)
        problems.push(...result.problems)
      } catch {
        problems.push(`“${task.title}” could not be duplicated.`)
      }
    }
    refreshTasks(qc)

    const message = duplicateMessage(results, problems)
    if (results.length === 0) {
      if (problems.length > 0) useToastStore.getState().push('error', message)
      return []
    }
    // Subtasks before their parents, so a copy's own subtasks go first and no original is touched.
    const made = results.flatMap((r) => r.made).reverse()
    const undo: ToastAction = {
      label: 'Undo',
      onAction: () => {
        void (async () => {
          for (const task of made) {
            try {
              await deleteTask.mutateAsync({ task, deleteSubtasks: false })
            } catch {
              // The delete's own error toast says what went wrong.
            }
          }
        })()
      },
    }
    // A copy saved offline has no task to show yet.
    const single = results.length === 1 && !isTempTaskId(results[0].copy.id) ? results[0].copy : null
    const open: ToastAction | null = single ? { label: 'Open', onAction: () => openTask(single.id) } : null
    useToastStore.getState().push(problems.length > 0 ? 'error' : 'success', message, {
      action: open ?? undo,
      secondAction: open ? undo : undefined,
      durationMs: UNDO_TOAST_MS,
    })
    return results.map((r) => r.copy)
  }, [qc, createTask, deleteTask, addLabel, toggleAssignee, access, openTask])
}
