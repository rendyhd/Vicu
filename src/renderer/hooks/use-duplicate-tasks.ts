import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { duplicateTask, duplicationRoots } from '@/lib/duplicate-task'
import { taskDescendants } from '@/lib/task-hierarchy'
import { refreshTasks } from '@/lib/task-refresh'
import type { Task } from '@/lib/vikunja-types'
import { toast } from '@/stores/toast-store'
import { useToggleAssignee } from './use-assignee-mutations'
import { useProjectAccessMap } from './use-project-access'
import { useAddLabel, useCreateTask } from './use-task-mutations'

/** The task as the server has it now (labels, reminders, assignees, subtasks), or the cached copy offline. */
async function fullTask(task: Task): Promise<Task> {
  const result = await api.fetchTaskById(task.id)
  return result.success ? result.data : task
}

/**
 * Duplicate (docs/cross-app-semantics-v1.md section 15) for the context menu and the card's More
 * menu: each task once, a selected subtask only with its selected parent, through the composer's
 * create path. Says what was made and what could not be copied; returns the copies.
 */
export function useDuplicateTasks(): (tasks: readonly Task[]) => Promise<Task[]> {
  const qc = useQueryClient()
  const createTask = useCreateTask()
  const addLabel = useAddLabel({ silent: true })
  const toggleAssignee = useToggleAssignee()
  const access = useProjectAccessMap()

  return useCallback(async (tasks) => {
    const copies: Task[] = []
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
        copies.push(result.copy)
        problems.push(...result.problems)
      } catch {
        problems.push(`“${task.title}” could not be duplicated.`)
      }
    }
    refreshTasks(qc)
    if (problems.length > 0) toast.error(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`)
    else if (copies.length > 0) toast.success(copies.length === 1 ? 'Task duplicated' : `${copies.length} tasks duplicated`)
    return copies
  }, [qc, createTask, addLabel, toggleAssignee, access])
}
