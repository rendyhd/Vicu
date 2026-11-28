import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { mapTaskInCaches, restoreTaskCaches, snapshotTaskCaches, type TaskCacheSnapshot } from '@/lib/pending-cache'
import { refreshTasks } from '@/lib/task-refresh'
import type { Task } from '@/lib/vikunja-types'
import { useSelectionStore } from '@/stores/selection-store'
import { toast } from '@/stores/toast-store'
import { useProjects } from './use-projects'
import { useUpdateTask } from './use-task-mutations'
import {
  planAttachMany,
  subtaskWorldOf,
  undoAttach,
  type AttachManyPlan,
  type AttachPlan,
  type UndoAttachPlan,
} from '../../shared/subtask-attach'

// Making an existing task a subtask of another, and taking it out again (cross-app semantics 24).
// Each relation change goes through the main process write gate (queued offline); a project move is
// an ordinary task update. Undo sends the plan the other way round.

type SectionEntry = { tasks?: Task[] }

/** Every task the window holds in a list, for the parents and projects the rules walk. */
export function cachedTasks(qc: QueryClient): Task[] {
  const byId = new Map<number, Task>()
  const add = (tasks: Task[] | undefined) => {
    for (const task of tasks ?? []) if (task && typeof task.id === 'number' && !byId.has(task.id)) byId.set(task.id, task)
  }
  for (const key of ['tasks', 'view-tasks'] as const) {
    for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: [key] })) if (Array.isArray(data)) add(data)
  }
  for (const [, data] of qc.getQueriesData<SectionEntry[]>({ queryKey: ['section-tasks'] })) {
    for (const entry of data ?? []) add(entry?.tasks)
  }
  return [...byId.values()]
}

type Related = Pick<Task, 'id' | 'title' | 'done' | 'project_id'>
const stub = (task: Related): Task => ({ id: task.id, title: task.title, done: task.done, project_id: task.project_id }) as Task

type Relations = Record<string, Task[] | undefined>

/** The caches show the change at once: the task under its new parent, gone from the old ones. */
function showAttached(qc: QueryClient, task: Task, parent: Task, removed: readonly number[]) {
  mapTaskInCaches(qc, task.id, (current) => ({
    ...current,
    related_tasks: { ...(current.related_tasks ?? {}), parenttask: [stub(parent)] } as Task['related_tasks'],
  }))
  mapTaskInCaches(qc, parent.id, (current) => {
    const related = (current.related_tasks ?? {}) as Relations
    const subtasks = (related.subtask ?? []).filter((entry) => entry.id !== task.id)
    return { ...current, related_tasks: { ...related, subtask: [...subtasks, stub(task)] } as Task['related_tasks'] }
  })
  // The open card's subtask list (`useSubtasks`) keeps the parent's subtasks under its id.
  qc.setQueryData<Task[]>(['task-detail', parent.id], (old) => (old ? [...old.filter((entry) => entry.id !== task.id), stub(task)] : old))
  for (const old of removed) showDetached(qc, task, old)
}

function showDetached(qc: QueryClient, task: Pick<Task, 'id'>, parentId: number) {
  mapTaskInCaches(qc, parentId, (current) => {
    const related = (current.related_tasks ?? {}) as Relations
    return { ...current, related_tasks: { ...related, subtask: (related.subtask ?? []).filter((entry) => entry.id !== task.id) } as Task['related_tasks'] }
  })
  mapTaskInCaches(qc, task.id, (current) => {
    const related = (current.related_tasks ?? {}) as Relations
    return { ...current, related_tasks: { ...related, parenttask: (related.parenttask ?? []).filter((entry) => entry.id !== parentId) } as Task['related_tasks'] }
  })
  qc.setQueryData<Task[]>(['task-detail', parentId], (old) => (old ? old.filter((entry) => entry.id !== task.id) : old))
}

function check(result: { success: boolean }) {
  if (!result.success) throw apiError(result as { success: false; error: string })
}

interface AttachVariables {
  tasks: Task[]
  parent: Task
  /** Planned once, from the caches as they were before the change shows in them. */
  plan: AttachManyPlan
  known: Task[]
}

interface AttachOutcome {
  plan: AttachManyPlan
  undo: UndoAttachPlan[]
}

/**
 * `attach(tasks, parent)` puts the tasks under `parent`; `detach(task, parentId)` takes a task out of
 * one parent. Both tell the person what happened, with Undo.
 */
export function useSubtaskAttach() {
  const qc = useQueryClient()
  const { t } = useTranslation()
  const { data: projectData } = useProjects()
  const updateTask = useUpdateTask({ silent: true })
  const clearSelection = useSelectionStore((s) => s.clearSelection)

  const projectTitle = useCallback((id: number) => projectData?.flat.find((p) => p.id === id)?.title ?? '', [projectData])

  const titleOf = (id: number, known: readonly Task[]) => known.find((task) => task.id === id)?.title

  /** Sends one plan; the steps that went through are what Undo has to put back. */
  const send = async (plan: AttachPlan, task: Task, parent: Task, known: readonly Task[]) => {
    if (plan.add !== null) check(await api.attachSubtask(plan.add, task.id, parent.title))
    for (const old of plan.remove) check(await api.detachSubtask(old, task.id, titleOf(old, known)))
    if (plan.project !== null) {
      await updateTask.mutateAsync({ id: task.id, changes: { project_id: plan.project }, original: task })
    }
  }

  const sendUndo = async (undo: UndoAttachPlan, task: Task | undefined) => {
    const known = cachedTasks(qc)
    if (undo.remove !== null) check(await api.detachSubtask(undo.remove, undo.task, titleOf(undo.remove, known)))
    for (const old of undo.add) check(await api.attachSubtask(old, undo.task, titleOf(old, known)))
    if (undo.project !== null) {
      const current = known.find((entry) => entry.id === undo.task) ?? task
      await updateTask.mutateAsync({ id: undo.task, changes: { project_id: undo.project }, original: current })
    }
  }

  const undoMutation = useMutation({
    meta: { action: 'undo the move under another task' },
    mutationFn: async (undos: Array<{ undo: UndoAttachPlan; task?: Task }>) => {
      for (const { undo, task } of undos) await sendUndo(undo, task)
    },
    onSettled: () => {
      refreshTasks(qc)
    },
  })

  const attachMutation = useMutation<AttachOutcome, Error, AttachVariables, { snapshot: TaskCacheSnapshot }>({
    meta: { action: 'move the task under another' },
    mutationFn: async ({ tasks, parent, plan, known }) => {
      const undo: UndoAttachPlan[] = []
      try {
        for (const step of plan.plans) {
          const task = tasks.find((entry) => entry.id === step.task)!
          await send(step, task, parent, known)
          undo.push(undoAttach(step, task.project_id))
        }
      } catch (error) {
        // What went through before the failure stays; Undo is offered for it in the error's place.
        if (undo.length > 0) offerUndo({ plan: { ...plan, plans: plan.plans.slice(0, undo.length) }, undo }, parent, tasks)
        throw error
      }
      return { plan, undo }
    },
    onMutate: async ({ tasks, parent, plan }) => {
      for (const key of ['tasks', 'view-tasks', 'section-tasks', 'task-detail']) await qc.cancelQueries({ queryKey: [key] })
      const snapshot = snapshotTaskCaches(qc)
      for (const step of plan.plans) {
        const task = tasks.find((entry) => entry.id === step.task)
        if (task) showAttached(qc, task, parent, step.remove)
      }
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskCaches(qc, context.snapshot)
    },
    onSuccess: (outcome, { tasks, parent }) => {
      offerUndo(outcome, parent, tasks)
    },
    onSettled: () => {
      refreshTasks(qc)
    },
  })

  /** One toast: what moved (and where), how many could not, and Undo. */
  const offerUndo = (outcome: AttachOutcome, parent: Task, tasks: readonly Task[]) => {
    const { plan, undo } = outcome
    const moved = plan.plans.length + plan.kept.length
    const refused = plan.refused.length
    if (moved === 0) {
      const only = plan.refused[0]
      if (refused === 1 && only?.refusal === 'already') toast.info(t('task.attach.already', { parent: parent.title }))
      else if (refused === 1 && only?.refusal === 'cycle') toast.info(t('task.attach.loop'))
      else if (refused > 0) toast.info(t('task.attach.notMoved', { count: refused }))
      return
    }
    const intoProject = plan.plans.some((step) => step.project !== null)
    const message = intoProject
      ? t('task.attach.movedToProject', { count: moved, parent: parent.title, project: projectTitle(parent.project_id) })
      : t('task.attach.moved', { count: moved, parent: parent.title })
    toast.success(message, {
      action: {
        label: t('task.attach.undo'),
        onAction: () => undoMutation.mutate(undo.map((step) => ({ undo: step, task: tasks.find((task) => task.id === step.task) }))),
      },
    })
    // A sentence of its own: translated sentences are never joined.
    if (refused > 0) toast.info(t('task.attach.notMoved', { count: refused }))
  }

  // `mutate` keeps its identity across renders, so `attach` and `detach` do too (a drag handler
  // lists them as dependencies).
  const attachMutate = attachMutation.mutate
  const attach = useCallback(
    (tasks: Task[], parent: Task) => {
      if (tasks.length === 0) return
      const known = [...cachedTasks(qc), ...tasks, parent]
      const plan = planAttachMany(subtaskWorldOf(known), tasks.map((task) => task.id), parent.id)
      // Nothing to send: say why at once, without touching the caches.
      if (plan.plans.length === 0 && plan.kept.length === 0) {
        offerUndo({ plan, undo: [] }, parent, tasks)
        return
      }
      attachMutate({ tasks, parent, plan, known })
      if (tasks.length > 1) clearSelection()
    },
    // offerUndo reads the translation and the project names of this render.
    [attachMutate, clearSelection, qc, t, projectData],
  )

  const detachMutation = useMutation({
    meta: { action: 'remove the task from its parent' },
    mutationFn: async ({ task, parentId }: { task: Task; parentId: number }) => {
      check(await api.detachSubtask(parentId, task.id, titleOf(parentId, cachedTasks(qc))))
    },
    onMutate: async ({ task, parentId }) => {
      for (const key of ['tasks', 'view-tasks', 'section-tasks', 'task-detail']) await qc.cancelQueries({ queryKey: [key] })
      const snapshot = snapshotTaskCaches(qc)
      showDetached(qc, task, parentId)
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (context) restoreTaskCaches(qc, context.snapshot)
    },
    onSuccess: (_data, { task, parentId }) => {
      toast.success(t('task.attach.removed', { title: task.title }), {
        action: {
          label: t('task.attach.undo'),
          onAction: () => undoMutation.mutate([{ undo: { task: task.id, remove: null, add: [parentId], project: null }, task }]),
        },
      })
    },
    onSettled: () => {
      refreshTasks(qc)
    },
  })

  const detachMutate = detachMutation.mutate
  const detach = useCallback((task: Task, parentId: number) => detachMutate({ task, parentId }), [detachMutate])

  return useMemo(() => ({ attach, detach }), [attach, detach])
}

/** The parent a task is listed under, when it has one. */
export function parentIdOf(task: Pick<Task, 'related_tasks'>): number | null {
  const parent = task.related_tasks?.parenttask?.[0]
  return parent && typeof parent.id === 'number' ? parent.id : null
}
