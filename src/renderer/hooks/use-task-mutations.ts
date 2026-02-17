import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import type {
  Task,
  CreateTaskPayload,
  UpdateTaskPayload,
  CreateProjectPayload,
  UpdateProjectPayload,
  CreateLabelPayload,
  UpdateLabelPayload,
} from '@/lib/vikunja-types'

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
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const result = await api.deleteTask(id)
      if (!result.success) throw new Error(result.error)
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.filter((t) => t.id !== id)
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.filter((t) => t.id !== id)
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
    },
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
