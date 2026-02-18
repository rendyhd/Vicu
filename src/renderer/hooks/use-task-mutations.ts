import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import type {
  Task,
  TaskAttachment,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateProjectPayload,
  UpdateProjectPayload,
  CreateLabelPayload,
  UpdateLabelPayload,
} from '@/lib/vikunja-types'
import type { SectionData } from './use-project-sections'

export function useAddLabel() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ taskId, labelId }: { taskId: number; labelId: number }) => {
      const result = await api.addLabelToTask(taskId, labelId)
      if (!result.success) throw new Error(result.error)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

export function useRemoveLabel() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ taskId, labelId }: { taskId: number; labelId: number }) => {
      const result = await api.removeLabelFromTask(taskId, labelId)
      if (!result.success) throw new Error(result.error)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

export function useCreateSubtask() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      parentTask,
      title,
    }: {
      parentTask: Task
      title: string
    }) => {
      // Create the child task in the same project
      const createResult = await api.createTask(parentTask.project_id, { title })
      if (!createResult.success) throw new Error(createResult.error)
      const childTask = createResult.data as Task

      // Create the subtask relation (parent → child)
      const relationResult = await api.createTaskRelation(
        parentTask.id,
        childTask.id,
        'subtask'
      )
      if (!relationResult.success) throw new Error(relationResult.error)

      return childTask
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

export function useCreateTask() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      task,
    }: {
      projectId: number
      task: CreateTaskPayload
    }) => {
      const result = await api.createTask(projectId, task)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['section-tasks'] })
    },
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, task }: { id: number; task: UpdateTaskPayload }) => {
      const result = await api.updateTask(id, task)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onMutate: async ({ id, task }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...task } : t))
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...task } : t))
      )

      return { previousTaskQueries, previousViewQueries }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousTaskQueries) {
        for (const [key, data] of context.previousTaskQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousViewQueries) {
        for (const [key, data] of context.previousViewQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['section-tasks'] })
      // Refresh per-task reminder timers in main process (fire-and-forget)
      api.refreshTaskReminders()
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    mutationFn: async (id: number) => {
      const result = await api.deleteTask(id)
      if (!result.success) throw new Error(result.error)
    },
    onMutate: async (id) => {
      // Remove from completed-tasks store so merge logic doesn't re-inject it
      const completedEntry = useCompletedTasksStore.getState().tasks.get(id)
      removeCompleted(id)

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      await qc.cancelQueries({ queryKey: ['section-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionData[]>({
        queryKey: ['section-tasks'],
      })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.filter((t) => t.id !== id)
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.filter((t) => t.id !== id)
      )
      qc.setQueriesData<SectionData[]>({ queryKey: ['section-tasks'] }, (old) =>
        old?.map((section) => ({
          ...section,
          tasks: section.tasks.filter((t) => t.id !== id),
        }))
      )

      return { previousTaskQueries, previousViewQueries, previousSectionQueries, completedEntry }
    },
    onError: (_err, _vars, context) => {
      if (context?.completedEntry) {
        useCompletedTasksStore
          .getState()
          .add(context.completedEntry.task, context.completedEntry.path)
      }
      if (context?.previousTaskQueries) {
        for (const [key, data] of context.previousTaskQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousViewQueries) {
        for (const [key, data] of context.previousViewQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousSectionQueries) {
        for (const [key, data] of context.previousSectionQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
      qc.invalidateQueries({ queryKey: ['section-tasks'] })
    },
  })
}

export function useReorderTask() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      viewId,
      position,
    }: {
      taskId: number
      viewId: number
      position: number
    }) => {
      const result = await api.updateTaskPosition(taskId, viewId, position)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onMutate: ({ taskId, position }) => {
      qc.cancelQueries({ queryKey: ['view-tasks'] })
      qc.cancelQueries({ queryKey: ['section-tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<Task[]>({ queryKey: ['section-tasks'] })

      // Update position AND sort so the array order matches the new visual order immediately.
      // Without sorting, @dnd-kit clears transforms on drop and items snap back to the old array order.
      const reorder = (old: Task[] | undefined) => {
        if (!old) return old
        const updated = old.map((t) => (t.id === taskId ? { ...t, position } : t))
        return updated.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      }

      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, reorder)
      qc.setQueriesData<Task[]>({ queryKey: ['section-tasks'] }, reorder)

      return { previousViewQueries, previousSectionQueries }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousViewQueries) {
        for (const [key, data] of context.previousViewQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousSectionQueries) {
        for (const [key, data] of context.previousSectionQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: () => {
      // Delay invalidation so the refetch doesn't cause a secondary re-render
      // while @dnd-kit is still settling after the drop.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['view-tasks'] })
        qc.invalidateQueries({ queryKey: ['section-tasks'] })
      }, 300)
    },
  })
}

export function useCompleteTask() {
  const qc = useQueryClient()
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const addCompleted = useCompletedTasksStore((s) => s.add)
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    mutationFn: async (task: Task) => {
      // Send full task object to work around Go zero-value problem
      const result = await api.updateTask(task.id, {
        ...task,
        done: true,
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onMutate: async (task) => {
      // Track completed task so it stays visible (with strikethrough) until navigation
      addCompleted({ ...task, done: true }, pathname)

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((t) => (t.id === task.id ? { ...t, done: true } : t))
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((t) => (t.id === task.id ? { ...t, done: true } : t))
      )

      return { previousTaskQueries, previousViewQueries }
    },
    onError: (_err, task, context) => {
      removeCompleted(task.id)
      if (context?.previousTaskQueries) {
        for (const [key, data] of context.previousTaskQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousViewQueries) {
        for (const [key, data] of context.previousViewQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    // Skip invalidation — the optimistic update keeps the task at its original
    // position with strikethrough. The store provides a fallback if another
    // mutation triggers a refetch. Full sync happens on navigation.
  })
}

export function useUncompleteTask() {
  const qc = useQueryClient()
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const addToStore = useCompletedTasksStore((s) => s.add)
  const updateCompleted = useCompletedTasksStore((s) => s.update)
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    mutationFn: async (task: Task) => {
      const result = await api.updateTask(task.id, {
        ...task,
        done: false,
      })
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onMutate: async (task) => {
      // If task was recently completed (in store), update to done:false.
      // Otherwise (e.g. logbook uncomplete), add a new store entry so it
      // stays visible without strikethrough until navigation.
      const wasInStore = useCompletedTasksStore.getState().tasks.has(task.id)
      if (wasInStore) {
        updateCompleted(task.id, { done: false })
      } else {
        addToStore({ ...task, done: false }, pathname)
      }

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((t) => (t.id === task.id ? { ...t, done: false } : t))
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((t) => (t.id === task.id ? { ...t, done: false } : t))
      )

      return { previousTaskQueries, previousViewQueries, wasInStore }
    },
    onError: (_err, task, context) => {
      if (context?.wasInStore) {
        updateCompleted(task.id, { done: true })
      } else {
        removeCompleted(task.id)
      }
      if (context?.previousTaskQueries) {
        for (const [key, data] of context.previousTaskQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousViewQueries) {
        for (const [key, data] of context.previousViewQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    // Skip invalidation — the optimistic update keeps the task at its original
    // position. The store provides a fallback if another mutation triggers a
    // refetch. Full sync happens on navigation.
  })
}

// --- Projects ---

export function useCreateProject() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (project: CreateProjectPayload) => {
      const result = await api.createProject(project)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['section-tasks'] })
    },
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, project }: { id: number; project: UpdateProjectPayload }) => {
      const result = await api.updateProject(id, project)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useReorderProject() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, project }: { id: number; project: UpdateProjectPayload }) => {
      const result = await api.updateProject(id, project)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onMutate: ({ id, project }) => {
      qc.cancelQueries({ queryKey: ['projects'] }) // fire-and-forget
      const previous = qc.getQueryData<import('@/lib/vikunja-types').Project[]>(['projects'])

      if (previous && project.position !== undefined) {
        qc.setQueryData<import('@/lib/vikunja-types').Project[]>(
          ['projects'],
          previous.map((p) => (p.id === id ? { ...p, position: project.position! } : p))
        )
      }

      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['projects'], context.previous)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const matches = useMatches()

  return useMutation({
    mutationFn: async (id: number) => {
      const result = await api.deleteProject(id)
      if (!result.success) throw new Error(result.error)
    },
    onSuccess: (_data, id) => {
      const currentPath = matches[matches.length - 1]?.pathname ?? ''
      if (currentPath === `/project/${id}`) {
        navigate({ to: '/inbox' })
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['section-tasks'] })
    },
  })
}

// --- Labels ---

export function useCreateLabel() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (label: CreateLabelPayload) => {
      const result = await api.createLabel(label)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

export function useUpdateLabel() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, label }: { id: number; label: UpdateLabelPayload }) => {
      const result = await api.updateLabel(id, label)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

export function useDeleteLabel() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const matches = useMatches()

  return useMutation({
    mutationFn: async (id: number) => {
      const result = await api.deleteLabel(id)
      if (!result.success) throw new Error(result.error)
    },
    onSuccess: (_data, id) => {
      const currentPath = matches[matches.length - 1]?.pathname ?? ''
      if (currentPath === `/tag/${id}`) {
        navigate({ to: '/inbox' })
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task-detail'] })
    },
  })
}

// --- Attachments ---

export function useTaskAttachments(taskId: number, enabled: boolean) {
  return useQuery<TaskAttachment[]>({
    queryKey: ['task-attachments', taskId],
    queryFn: async () => {
      const result = await api.fetchTaskAttachments(taskId)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    enabled,
  })
}

export function useUploadAttachment() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (taskId: number) => {
      const result = await api.pickAndUploadAttachment(taskId)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: (_data, _err, taskId) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', taskId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
    },
  })
}

export function useUploadAttachmentFromDrop() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      taskId,
      fileData,
      fileName,
      mimeType,
    }: {
      taskId: number
      fileData: Uint8Array
      fileName: string
      mimeType: string
    }) => {
      const result = await api.uploadTaskAttachment(taskId, fileData, fileName, mimeType)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ taskId, attachmentId }: { taskId: number; attachmentId: number }) => {
      const result = await api.deleteTaskAttachment(taskId, attachmentId)
      if (!result.success) throw new Error(result.error)
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['view-tasks'] })
    },
  })
}
