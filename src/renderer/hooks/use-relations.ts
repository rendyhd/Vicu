import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { mapTaskInCaches } from '@/lib/pending-cache'
import type { Task } from '@/lib/vikunja-types'

// Pro's "after" (cross-app semantics 21.2): a task waits on another through Vikunja's `blocked`
// relation (the server adds the inverse `blocking`). Each change is its own request through the main
// process write gate, queued offline (decision 24). The change shows at once in every cached list.

interface AfterVars {
  task: Pick<Task, 'id' | 'title'>
  /** The task it waits on, with the fields a row shows. */
  other: Pick<Task, 'id' | 'title' | 'done'>
  add: boolean
}

type Related = { id: number; title?: string; done?: boolean }

function setAfter(qc: QueryClient, task: number, other: Related, add: boolean) {
  mapTaskInCaches(qc, task, (current) => {
    const related = { ...(current.related_tasks ?? {}) } as Record<string, Related[]>
    const blocked = (related.blocked ?? []).filter((entry) => entry.id !== other.id)
    related.blocked = add ? [...blocked, other] : blocked
    return { ...current, related_tasks: related as Task['related_tasks'] }
  })
}

export function useToggleAfter() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'change what the task waits on' },
    mutationFn: async ({ task, other, add }: AfterVars) => {
      const result = add ? await api.addAfter(task.id, other.id, task.title) : await api.removeAfter(task.id, other.id, task.title)
      if (!result.success) throw apiError(result)
    },
    onMutate: async ({ task, other, add }) => {
      for (const key of ['tasks', 'view-tasks', 'section-tasks', 'task-detail']) await qc.cancelQueries({ queryKey: [key] })
      setAfter(qc, task.id, { id: other.id, title: other.title, done: other.done }, add)
    },
    onError: (_error, { task, other, add }) => {
      setAfter(qc, task.id, { id: other.id, title: other.title, done: other.done }, !add)
    },
  })
}

/** The open tasks a task waits on, as its cached copy lists them. */
export function blockersOf(task: Pick<Task, 'related_tasks'>): Related[] {
  const related = (task.related_tasks ?? {}) as Record<string, Related[] | undefined>
  return (related.blocked ?? []).filter((entry) => !entry.done)
}
