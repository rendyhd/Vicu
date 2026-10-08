import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useMatches, useRouter } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { completionHold } from '@/stores/completion-hold-store'
import { sortProjectTasks } from '@/lib/task-sort'
import {
  applyPositionUpdates,
  sendPositionUpdates,
  type PositionUpdate,
  type SiblingPositionUpdate,
} from '@/lib/reorder-positions'
import { playCompletionSound } from '@/lib/completion-sound'
import {
  mapTaskDoneByIds,
  removeTaskIdsFromTree,
  taskDescendants,
  unfinishedDescendants,
} from '@/lib/task-hierarchy'
import { updateTaskDetailDone } from '@/lib/task-detail-cache'
import { projectPatch, taskPatch } from '@/lib/merge-patches'
import {
  addLabelOrQueue,
  createTaskOrQueue,
  deleteTaskOrQueue,
  removeLabelOrQueue,
  sendTaskPatch,
  type CreateExtras,
} from '@/lib/offline-mutations'
import { ApiError, apiError, type MutationMeta } from '@/lib/mutation-errors'
import {
  insertPendingTask,
  isTempTaskId,
  mapTaskInCaches,
  restoreTaskCaches,
  snapshotTaskCaches,
} from '@/lib/pending-cache'
import { refreshTasks } from '@/lib/task-refresh'
import { ACCOUNT_CHANGED_EVENT } from '@/lib/account-events'
import { currentPathname } from '@/lib/route-path'
import {
  createNewTaskPlacer,
  placeNewTaskInBackground,
  readPositionHints,
} from '@/lib/new-task-position'
import { useOfflineStore } from '@/stores/offline-store'
import type {
  Task,
  Project,
  Label,
  TaskAttachment,
  CreateTaskPayload,
  CreateProjectPayload,
  CreateLabelPayload,
  UpdateLabelPayload,
} from '@/lib/vikunja-types'
import {
  updateSectionTaskCache,
  type SectionTaskCacheEntry,
} from '@/lib/section-task-cache'

// Vikunja puts a new task at the top of the list view. Anchoring it at the end takes one position
// update per create; the list view id and the last position are remembered per project and the
// update runs in the background, so a create costs the caller one request (D-REN-7). See
// src/renderer/lib/new-task-position.ts.
const newTaskPlacer = createNewTaskPlacer({
  fetchProjectViews: (projectId) => api.fetchProjectViews(projectId),
  fetchViewTasks: (projectId, viewId, params) => api.fetchViewTasks(projectId, viewId, params),
  updateTaskPosition: (taskId, viewId, position) => api.updateTaskPosition(taskId, viewId, position),
})

// Another account has other projects and views.
if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_CHANGED_EVENT, () => newTaskPlacer.invalidate())
}

/**
 * Put a new task at the end of its project's list in the background. When it is done (or could not
 * be), the project's lists refresh so the task shows up where it belongs; `refreshLists` is false
 * for a caller that refreshes them itself.
 */
function placeNewTaskAtEnd(
  qc: ReturnType<typeof useQueryClient>,
  projectId: number,
  taskId: number,
  refreshLists = true
): void {
  placeNewTaskInBackground(newTaskPlacer, projectId, taskId, readPositionHints(qc, projectId), (placed) => {
    // The cached views were wrong (or unreachable): read them again before the next create.
    if (!placed) void qc.invalidateQueries({ queryKey: ['project-views', projectId] })
    if (refreshLists) refreshTasks(qc, [['view-tasks'], ['section-tasks']])
  })
}

/**
 * Options every task mutation hook takes. `silent` is for a caller that shows the failure itself
 * (the composer's inline error): the global error toast is skipped (D-REN-3).
 */
export interface MutationHookOptions {
  silent?: boolean
}

const metaFor = (action: string, options?: MutationHookOptions): MutationMeta => ({
  action,
  ...(options?.silent ? { silent: true } : {}),
})

/** A task as the caches hold it (for the title of a queued change). */
function cachedTask(qc: ReturnType<typeof useQueryClient>, id: number): Task | undefined {
  const lists = [
    ...qc.getQueriesData<Task[]>({ queryKey: ['tasks'] }),
    ...qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] }),
  ]
  for (const [, data] of lists) {
    const found = data?.find((t) => t.id === id)
    if (found) return found
  }
  for (const [, entries] of qc.getQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] })) {
    for (const entry of entries ?? []) {
      const found = entry.tasks.find((t) => t.id === id)
      if (found) return found
    }
  }
  return undefined
}

/** Show or hide a label on a task in every cache, so the change is visible at once and while queued. */
function setLabelInCaches(qc: ReturnType<typeof useQueryClient>, taskId: number, labelId: number, present: boolean) {
  const known = qc.getQueryData<Label[]>(['labels'])?.find((l) => l.id === labelId)
  const label: Label = known ?? { id: labelId, title: '', hex_color: '', created: '', updated: '' }
  mapTaskInCaches(qc, taskId, (task) => {
    const others = (task.labels ?? []).filter((l) => l.id !== labelId)
    return { ...task, labels: present ? [...others, label] : others }
  })
}

function useLabelMutation(kind: 'add' | 'remove', options?: MutationHookOptions) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ taskId, labelId }: { taskId: number; labelId: number }) => {
      const title = cachedTask(qc, taskId)?.title
      if (kind === 'add') {
        const label = qc.getQueryData<Label[]>(['labels'])?.find((l) => l.id === labelId)
        await addLabelOrQueue(taskId, { id: labelId, title: label?.title || undefined }, title)
      } else {
        await removeLabelOrQueue(taskId, labelId, title)
      }
    },
    onMutate: async ({ taskId, labelId }) => {
      for (const queryKey of ['tasks', 'view-tasks', 'section-tasks', 'task-detail']) await qc.cancelQueries({ queryKey: [queryKey] })
      const previous = snapshotTaskCaches(qc)
      setLabelInCaches(qc, taskId, labelId, kind === 'add')
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) restoreTaskCaches(qc, context.previous)
    },
    onSettled: () => {
      refreshTasks(qc)
    },
    meta: metaFor(kind === 'add' ? 'add the label' : 'remove the label', options),
  })
}

export function useAddLabel(options?: MutationHookOptions) {
  return useLabelMutation('add', options)
}

export function useRemoveLabel(options?: MutationHookOptions) {
  return useLabelMutation('remove', options)
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
      // The relation needs both tasks on the server; the offline queue has no relations yet.
      if (isTempTaskId(parentTask.id)) {
        throw new ApiError('This task has not synced yet. Add subtasks once it has been saved.')
      }
      // Create the child task in the same project
      const createResult = await api.createTask(parentTask.project_id, { title })
      if (!createResult.success) throw apiError(createResult)
      const childTask = createResult.data as Task
      // In the background; the mutation's own refresh below shows the subtask inside its parent.
      placeNewTaskAtEnd(qc, parentTask.project_id, childTask.id, false)

      // Create the subtask relation (parent → child)
      const relationResult = await api.createTaskRelation(
        parentTask.id,
        childTask.id,
        'subtask'
      )
      if (!relationResult.success) throw apiError(relationResult)

      return childTask
    },
    onSettled: () => {
      refreshTasks(qc)
    },
    meta: metaFor('add the subtask'),
  })
}

export function useCreateTask(options?: MutationHookOptions) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      task,
      extras,
    }: {
      projectId: number
      task: CreateTaskPayload
      /** Labels and images the queue keeps with the create if it has to be queued offline. */
      extras?: CreateExtras
    }) => {
      const outcome = await createTaskOrQueue(projectId, task, extras)
      // A queued create has no real id yet; its stand-in carries a temp id. The position update
      // does not hold the create back; the project's lists refresh once it has landed.
      if (!outcome.queued) placeNewTaskAtEnd(qc, projectId, outcome.task.id)
      return outcome.task
    },
    onSuccess: (task) => {
      if (isTempTaskId(task.id)) insertPendingTask(qc, task)
      // The project's own lists wait for the position update, so a new task does not show at the
      // top first and then jump to the end.
      else refreshTasks(qc, [['tasks'], ['task-detail']])
    },
    meta: metaFor('create the task', options),
  })
}

export interface UpdateTaskVariables {
  id: number
  /**
   * The fields the user changed, e.g. `{ priority: 2 }`. Never spread a whole
   * task in here: only changed writable fields are sent (D-REN-2), so a stale
   * cache cannot revert what another client changed.
   */
  changes: Partial<Task>
  /**
   * The cached task the changes were made against. The request is diffed against
   * it (`taskPatch`), and cross-project moves use it to place the task in the
   * destination cache optimistically.
   */
  original?: Task
  // Caller signals that a reorderTask call follows and will own
  // view-tasks/section-tasks invalidation. Don't read it here; it's
  // consumed in onSettled.
  deferInvalidation?: boolean
}

/** Send an edit as a minimal merge patch; skip the request when nothing differs. */
export async function updateTaskRequest({
  id,
  changes,
  original,
}: Pick<UpdateTaskVariables, 'id' | 'changes' | 'original'>): Promise<Task | null> {
  // Position is per-view in Vikunja and only honored by /tasks/{id}/position
  // (see useReorderTask). Strip it from the regular update body so it
  // can't be written to an unintended view; we still keep it on `changes`
  // for the optimistic-update path so the UI lands at the right slot.
  const { position: _position, ...writable } = changes
  const patch = taskPatch(original ?? null, writable)
  // Nothing differs from what the server already has (e.g. setting today's
  // date on a task that is already due today): skip the request.
  if (Object.keys(patch).length === 0) return original ?? null
  const title = original?.title ?? (typeof changes.title === 'string' ? changes.title : undefined)
  const outcome = await sendTaskPatch(id, patch, title)
  // A queued change has no server response; the optimistic cache already holds its result.
  return outcome.task ?? (original ? { ...original, ...changes } : null)
}

export function useUpdateTask(options?: MutationHookOptions) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (variables: UpdateTaskVariables) => updateTaskRequest(variables),
    onMutate: async ({ id, changes, original }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      await qc.cancelQueries({ queryKey: ['section-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionTaskCacheEntry[]>({
        queryKey: ['section-tasks'],
      })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...changes } : t))
      )
      // view-tasks is keyed ['view-tasks', projectId, viewId]. When the task's
      // project_id changes (drag-drop cross-section / sidebar / header drops),
      // updating in place would leave the task rendered in the SOURCE
      // project's TaskList AND in the destination's section — visible
      // duplication that reads as "the task didn't move" because the user
      // looks at where it was. Iterate keys so we can compare each cache's
      // projectId against the new project_id and either remove from
      // mismatched views or add to a matched one.
      const newProjectId = changes.project_id
      // A task added to a destination cache needs every field, not just the changes.
      const fullTask: Partial<Task> = original ? { ...original, ...changes } : changes
      const taskHasFullSpread = fullTask.title !== undefined
      const allViewTasks = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      for (const [key, oldData] of allViewTasks) {
        if (!oldData) continue
        const queryProjectId = (key as readonly unknown[])[1] as number | undefined
        const has = oldData.some((t) => t.id === id)
        let next: Task[] = oldData
        if (has) {
          if (
            newProjectId !== undefined &&
            queryProjectId !== undefined &&
            newProjectId !== queryProjectId
          ) {
            next = oldData.filter((t) => t.id !== id)
          } else {
            next = oldData.map((t) => (t.id === id ? { ...t, ...changes } : t))
          }
        } else if (
          taskHasFullSpread &&
          newProjectId !== undefined &&
          queryProjectId !== undefined &&
          newProjectId === queryProjectId
        ) {
          next = sortProjectTasks([...oldData, { ...fullTask, id } as Task])
        }
        if (next !== oldData) qc.setQueryData(key, next)
      }
      qc.setQueriesData<SectionTaskCacheEntry[]>(
        { queryKey: ['section-tasks'] },
        (old) => updateSectionTaskCache(old, id, changes, original)
      )

      return { previousTaskQueries, previousViewQueries, previousSectionQueries }
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
      if (context?.previousSectionQueries) {
        for (const [key, data] of context.previousSectionQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: (_data, _err, variables) => {
      // When the caller has a reorderTask queued behind us, skip the two
      // view-related invalidations and let reorderTask handle them after its
      // per-view position write completes — otherwise the refetch races the
      // in-flight position update and the task briefly snaps to position 0.
      // (Nothing is refetched while the offline queue still holds changes.)
      refreshTasks(qc, variables.deferInvalidation ? [['tasks']] : undefined)
      // Only refresh reminder timers when reminder-relevant fields changed
      const t = variables.changes
      if ('reminders' in t || 'due_date' in t) {
        api.refreshTaskReminders()
      }
    },
    meta: metaFor('save the change', options),
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    meta: metaFor('delete the task'),
    mutationFn: async ({ task, deleteSubtasks = true }: { task: Task; deleteSubtasks?: boolean }) => {
      const targets = deleteSubtasks
        ? [...taskDescendants(task).reverse(), task]
        : [task]
      for (const target of targets) {
        // A delete the server cannot take right now is queued; one for a pending create just
        // removes the create from the queue.
        await deleteTaskOrQueue(target.id, target.title)
      }
    },
    onMutate: async ({ task, deleteSubtasks = true }) => {
      const ids = new Set<number>([
        task.id,
        ...(deleteSubtasks ? taskDescendants(task).map((item) => item.id) : []),
      ])
      // Remove from completed-tasks store so merge logic doesn't re-inject it
      const completedEntries = [...ids]
        .map((id) => useCompletedTasksStore.getState().tasks.get(id))
        .filter((entry) => entry !== undefined)
      ids.forEach(removeCompleted)

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      await qc.cancelQueries({ queryKey: ['section-tasks'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionTaskCacheEntry[]>({
        queryKey: ['section-tasks'],
      })

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((item) => removeTaskIdsFromTree(item, ids)).filter((item): item is Task => item !== null)
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((item) => removeTaskIdsFromTree(item, ids)).filter((item): item is Task => item !== null)
      )
      qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) =>
        old?.map((section) => ({
          ...section,
          tasks: section.tasks
            .map((item) => removeTaskIdsFromTree(item, ids))
            .filter((item): item is Task => item !== null),
        }))
      )

      return { previousTaskQueries, previousViewQueries, previousSectionQueries, completedEntries }
    },
    onError: (_err, _vars, context) => {
      for (const entry of context?.completedEntries ?? []) {
        useCompletedTasksStore.getState().add(
          entry.task,
          entry.path,
          entry.autoCompletedSubtasks,
          entry.suppressTopLevelUndo,
        )
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
      refreshTasks(qc, [['tasks'], ['view-tasks'], ['section-tasks'], ['project-counts']])
      // A deleted task's reminders must not fire.
      api.refreshTaskReminders()
    },
  })
}

export function useReorderTask() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('move the task'),
    mutationFn: async ({
      taskId,
      viewId,
      position,
      renumbered = [],
    }: {
      taskId: number
      viewId: number
      position: number
      /** Other tasks whose positions change too: tasks that shared a position are spread apart (see planMove). */
      renumbered?: PositionUpdate[]
    }) => {
      // Positions are per view and are not queued offline.
      if (isTempTaskId(taskId) || renumbered.some((update) => isTempTaskId(update.taskId))) {
        throw new ApiError('This task has not synced yet. Reorder it once it has been saved.')
      }
      await sendPositionUpdates(
        async (update) => {
          const result = await api.updateTaskPosition(update.taskId, viewId, update.position)
          if (!result.success) throw apiError(result)
        },
        { taskId, position },
        renumbered,
      )
      // A task dragged to the end moves the end of the list; the next new task goes after it.
      newTaskPlacer.noteViewPosition(viewId, Math.max(position, ...renumbered.map((update) => update.position)))
    },
    onMutate: ({ taskId, position, renumbered = [] }) => {
      qc.cancelQueries({ queryKey: ['view-tasks'] })
      qc.cancelQueries({ queryKey: ['section-tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionTaskCacheEntry[]>({
        queryKey: ['section-tasks'],
      })

      // Update position AND sort so the array order matches the new visual order immediately.
      // Without sorting, @dnd-kit clears transforms on drop and items snap back to the old array order.
      const updates = [...renumbered, { taskId, position }]
      const reorderTasks = (old: Task[] | undefined) => {
        if (!old) return old
        return sortProjectTasks(applyPositionUpdates(old, updates))
      }

      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, reorderTasks)
      qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) => {
        if (!old) return old
        return old.map((section) => {
          if (!section.tasks.some((t) => t.id === taskId)) return section
          return { ...section, tasks: sortProjectTasks(applyPositionUpdates(section.tasks, updates)) }
        })
      })

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
        refreshTasks(qc, [['view-tasks'], ['section-tasks']])
      }, 300)
    },
  })
}

/** Take a done flag back: a completion still waiting in the queue is cancelled, anything else is reversed with a request. */
async function reverseDone(entry: { task: Task; queued: boolean }, done: boolean): Promise<void> {
  if (entry.queued) {
    const cancelled = await api.offlineQueue.cancelChange(entry.task.id, ['done'])
    if (cancelled.success && cancelled.data) return
  }
  await sendTaskPatch(entry.task.id, { done }, entry.task.title)
}

/**
 * Complete a task and its unfinished subtasks. Every request is just `{ done }`:
 * the embedded `related_tasks` copies are only used for their ids, never as patch
 * sources, so partial objects cannot clear fields. A step the server cannot take right
 * now (offline, server trouble) is queued instead and the rest carries on.
 */
export async function completeTaskRequest(task: Task): Promise<Task> {
  const autoCompleted = unfinishedDescendants(task)
  const completed: Array<{ task: Task; queued: boolean }> = []
  try {
    // Children first prevents the server from ever exposing them as standalone
    // work while the parent completion is in flight.
    for (const child of [...autoCompleted].reverse()) {
      const outcome = await sendTaskPatch(child.id, { done: true }, child.title)
      completed.push({ task: child, queued: outcome.queued })
    }
    const outcome = await sendTaskPatch(task.id, { done: true }, task.title)
    return outcome.task ?? { ...task, done: true }
  } catch (error) {
    await Promise.allSettled(completed.map((entry) => reverseDone(entry, false)))
    throw error
  }
}

/**
 * Reopen a task and the subtasks its completion auto-completed. A completion that is still waiting in
 * the offline queue is cancelled instead (the server never hears about it); one that is being sent
 * right now cannot be, so the reopen goes out behind it.
 */
export async function uncompleteTaskRequest(task: Task, autoCompleted: readonly Task[]): Promise<Task> {
  const restored: Array<{ task: Task; queued: boolean }> = []
  const reopen = async (item: Task): Promise<Task | null> => {
    if (useOfflineStore.getState().counts.pending > 0) {
      const cancelled = await api.offlineQueue.cancelChange(item.id, ['done'])
      if (cancelled.success && cancelled.data) {
        restored.push({ task: item, queued: false })
        return null
      }
    }
    const outcome = await sendTaskPatch(item.id, { done: false }, item.title)
    restored.push({ task: item, queued: outcome.queued })
    return outcome.task
  }
  try {
    for (const child of [...autoCompleted].reverse()) await reopen(child)
    const result = await reopen(task)
    return result ?? { ...task, done: false }
  } catch (error) {
    await Promise.allSettled(restored.map((entry) => reverseDone({ task: entry.task, queued: false }, true)))
    throw error
  }
}

export function useCompleteTask() {
  const qc = useQueryClient()
  // The path is read when a task is completed, not by subscribing to the router: every row has this
  // hook (and its checkbox two more), and a subscription re-rendered all of them on each navigation.
  const router = useRouter()
  const addCompleted = useCompletedTasksStore((s) => s.add)
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    meta: metaFor('complete the task'),
    mutationFn: async (input: Task | { task: Task; suppressTopLevelUndo?: boolean }) => {
      const task = 'task' in input ? input.task : input
      return completeTaskRequest(task)
    },
    onMutate: async (input) => {
      const task = 'task' in input ? input.task : input
      const suppressTopLevelUndo = 'task' in input && input.suppressTopLevelUndo === true
      const autoCompleted = unfinishedDescendants(task)
      const doneById = new Map<number, boolean>([
        [task.id, true],
        ...autoCompleted.map((child) => [child.id, true] as const),
      ])
      // Keep the row in its list, struck through, while the completion hold runs (a few seconds after
      // the pointer or focus leaves it, or until the user leaves the view); then the hold removes it.
      addCompleted(mapTaskDoneByIds(task, doneById), currentPathname(router), autoCompleted, suppressTopLevelUndo)
      completionHold.complete(task.id)

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      await qc.cancelQueries({ queryKey: ['section-tasks'] })
      await qc.cancelQueries({ queryKey: ['task-detail'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionTaskCacheEntry[]>({
        queryKey: ['section-tasks'],
      })
      const previousTaskDetailQueries = updateTaskDetailDone(qc, doneById)

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((item) => mapTaskDoneByIds(item, doneById))
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((item) => mapTaskDoneByIds(item, doneById))
      )
      qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) =>
        old?.map((section) => ({
          ...section,
          tasks: section.tasks.map((item) => mapTaskDoneByIds(item, doneById)),
        }))
      )

      return { previousTaskQueries, previousViewQueries, previousSectionQueries, previousTaskDetailQueries }
    },
    onSuccess: () => {
      playCompletionSound()
    },
    onError: (_err, input, context) => {
      const task = 'task' in input ? input.task : input
      removeCompleted(task.id)
      completionHold.reopened(task.id)
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
      if (context?.previousTaskDetailQueries) {
        for (const [key, data] of context.previousTaskDetailQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: () => {
      refreshTasks(qc, [['task-detail'], ['project-counts']])
      // Completing stops a task's reminders; a recurring task's advance to the next ones.
      api.refreshTaskReminders()
    },
    // Skip list invalidation — the optimistic update keeps the task at its
    // original position with strikethrough. Refresh task-detail separately so
    // the expanded subtask list stays in sync with the server.
  })
}

export function useUncompleteTask() {
  const qc = useQueryClient()
  const router = useRouter()
  const addToStore = useCompletedTasksStore((s) => s.add)
  const updateCompleted = useCompletedTasksStore((s) => s.update)
  const removeCompleted = useCompletedTasksStore((s) => s.remove)

  return useMutation({
    meta: metaFor('reopen the task'),
    mutationFn: async (task: Task) => {
      const autoCompleted = useCompletedTasksStore.getState().tasks
        .get(task.id)?.autoCompletedSubtasks ?? []
      return uncompleteTaskRequest(task, autoCompleted)
    },
    onMutate: async (task) => {
      // If task was recently completed (in store), update to done:false.
      // Otherwise (e.g. logbook uncomplete), add a new store entry so it
      // stays visible without strikethrough until navigation.
      const wasInStore = useCompletedTasksStore.getState().tasks.has(task.id)
      const autoCompleted = useCompletedTasksStore.getState().tasks
        .get(task.id)?.autoCompletedSubtasks ?? []
      // Unchecking a held row cancels its hold (no toast); a row reopened from the Logbook or the toast is just open.
      completionHold.reopened(task.id)
      const doneById = new Map<number, boolean>([
        [task.id, false],
        ...autoCompleted.map((child) => [child.id, false] as const),
      ])
      if (wasInStore) {
        updateCompleted(task.id, { done: false })
      } else {
        addToStore({ ...task, done: false }, currentPathname(router))
      }

      await qc.cancelQueries({ queryKey: ['tasks'] })
      await qc.cancelQueries({ queryKey: ['view-tasks'] })
      await qc.cancelQueries({ queryKey: ['section-tasks'] })
      await qc.cancelQueries({ queryKey: ['task-detail'] })
      const previousTaskQueries = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })
      const previousViewQueries = qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })
      const previousSectionQueries = qc.getQueriesData<SectionTaskCacheEntry[]>({
        queryKey: ['section-tasks'],
      })
      const previousTaskDetailQueries = updateTaskDetailDone(qc, doneById)

      qc.setQueriesData<Task[]>({ queryKey: ['tasks'] }, (old) =>
        old?.map((item) => mapTaskDoneByIds(item, doneById))
      )
      qc.setQueriesData<Task[]>({ queryKey: ['view-tasks'] }, (old) =>
        old?.map((item) => mapTaskDoneByIds(item, doneById))
      )
      qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) =>
        old?.map((section) => ({
          ...section,
          tasks: section.tasks.map((item) => mapTaskDoneByIds(item, doneById)),
        }))
      )

      return { previousTaskQueries, previousViewQueries, previousSectionQueries, previousTaskDetailQueries, wasInStore }
    },
    onError: (_err, task, context) => {
      if (context?.wasInStore) {
        updateCompleted(task.id, { done: true })
        // The reopen failed: the row is done again, so it is held again.
        completionHold.complete(task.id)
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
      if (context?.previousSectionQueries) {
        for (const [key, data] of context.previousSectionQueries) {
          qc.setQueryData(key, data)
        }
      }
      if (context?.previousTaskDetailQueries) {
        for (const [key, data] of context.previousTaskDetailQueries) {
          qc.setQueryData(key, data)
        }
      }
    },
    onSettled: () => {
      refreshTasks(qc, [['task-detail'], ['project-counts']])
      api.refreshTaskReminders()
    },
    // Skip list invalidation — the optimistic update keeps the task at its
    // original position. Refresh task-detail separately for expanded subtasks.
  })
}

// --- Projects ---

export function useCreateProject() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('create the project'),
    mutationFn: async (project: CreateProjectPayload) => {
      const result = await api.createProject(project)
      if (!result.success) throw apiError(result)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      refreshTasks(qc, [['section-tasks']])
    },
  })
}

export interface UpdateProjectVariables {
  id: number
  /**
   * The fields that changed, e.g. `{ title: 'New name' }`. Only changed writable
   * fields are sent (D-PROJ-1): a stale cached description must never overwrite a
   * concurrent edit, and keys outside the PATCH schema (a tree node's `children`)
   * are rejected by the server with a 422.
   */
  changes: Partial<Project>
  /** The cached project the changes were made against; the request is diffed against it. */
  original?: Project
}

/** Send a project edit as a minimal merge patch; skip the request when nothing differs. */
export async function updateProjectRequest({
  id,
  changes,
  original,
}: UpdateProjectVariables): Promise<Project | null> {
  const patch = projectPatch(original ?? null, changes)
  if (Object.keys(patch).length === 0) return original ?? null
  const result = await api.updateProject(id, patch)
  if (!result.success) throw apiError(result)
  return result.data
}

export function useUpdateProject() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('save the project'),
    mutationFn: (variables: UpdateProjectVariables) => updateProjectRequest(variables),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

/** Archive/restore sends only `is_archived` and updates the all-project cache. */
export function useSetProjectArchived() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const matches = useMatches()

  return useMutation({
    meta: metaFor('change the project'),
    mutationFn: ({ project, archived }: { project: Project; archived: boolean }) =>
      updateProjectRequest({ id: project.id, changes: { is_archived: archived }, original: project }),
    onMutate: async ({ project, archived }) => {
      await qc.cancelQueries({ queryKey: ['projects'] })
      const previous = qc.getQueryData<Project[]>(['projects'])
      if (previous) {
        qc.setQueryData<Project[]>(
          ['projects'],
          previous.map((item) => item.id === project.id ? { ...item, is_archived: archived } : item),
        )
      }
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) qc.setQueryData(['projects'], context.previous)
    },
    onSuccess: (_data, { project, archived }) => {
      const currentPath = matches[matches.length - 1]?.pathname ?? ''
      if (archived && currentPath === `/project/${project.id}`) {
        navigate({ to: '/inbox' })
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      refreshTasks(qc, [['tasks'], ['view-tasks'], ['section-tasks']])
    },
  })
}

export function useReorderProject() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('move the project'),
    // A reorder only ever changes positions: the dragged project's and, when its neighbours had
    // no room between them, the spread-out positions of its siblings (see planSiblingMove).
    mutationFn: async ({
      id,
      position,
      renumbered = [],
    }: {
      id: number
      position: number
      renumbered?: SiblingPositionUpdate[]
    }) => {
      await sendPositionUpdates<SiblingPositionUpdate>(
        async (update) => {
          await updateProjectRequest({ id: update.id, changes: { position: update.position } })
        },
        { id, position },
        renumbered,
      )
    },
    onMutate: ({ id, position, renumbered = [] }) => {
      qc.cancelQueries({ queryKey: ['projects'] }) // fire-and-forget
      const previous = qc.getQueryData<Project[]>(['projects'])

      if (previous) {
        const positions = new Map<number, number>(renumbered.map((update) => [update.id, update.position]))
        positions.set(id, position)
        qc.setQueryData<Project[]>(
          ['projects'],
          previous.map((p) => (positions.has(p.id) ? { ...p, position: positions.get(p.id)! } : p))
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
    meta: metaFor('delete the project'),
    mutationFn: async (id: number) => {
      const result = await api.deleteProject(id)
      if (!result.success) throw apiError(result)
    },
    onSuccess: (_data, id) => {
      newTaskPlacer.invalidate(id)
      const currentPath = matches[matches.length - 1]?.pathname ?? ''
      if (currentPath === `/project/${id}`) {
        navigate({ to: '/inbox' })
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      refreshTasks(qc, [['section-tasks']])
    },
  })
}

// --- Labels ---

export function useCreateLabel(options?: MutationHookOptions) {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('create the label', options),
    mutationFn: async (label: CreateLabelPayload) => {
      const result = await api.createLabel(label)
      if (!result.success) throw apiError(result)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      refreshTasks(qc, [['tasks'], ['task-detail']])
    },
  })
}

export function useUpdateLabel() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('save the label'),
    mutationFn: async ({ id, label }: { id: number; label: UpdateLabelPayload }) => {
      const result = await api.updateLabel(id, label)
      if (!result.success) throw apiError(result)
      return result.data
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      refreshTasks(qc)
    },
  })
}

export function useDeleteLabel() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const matches = useMatches()

  return useMutation({
    meta: metaFor('delete the label'),
    mutationFn: async (id: number) => {
      const result = await api.deleteLabel(id)
      if (!result.success) throw apiError(result)
    },
    onSuccess: (_data, id) => {
      const currentPath = matches[matches.length - 1]?.pathname ?? ''
      if (currentPath === `/tag/${id}`) {
        navigate({ to: '/inbox' })
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['labels'] })
      refreshTasks(qc)
    },
  })
}

// --- Attachments ---

export function useTaskAttachments(taskId: number, enabled: boolean) {
  return useQuery<TaskAttachment[]>({
    queryKey: ['task-attachments', taskId],
    queryFn: async () => {
      const result = await api.fetchTaskAttachments(taskId)
      if (!result.success) throw apiError(result)
      return result.data
    },
    enabled,
  })
}

export function useUploadAttachment() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('upload the attachment'),
    mutationFn: async (taskId: number) => {
      const result = await api.pickAndUploadAttachment(taskId)
      if (!result.success) throw apiError(result)
      return result.data
    },
    onSettled: (_data, _err, taskId) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', taskId] })
      refreshTasks(qc, [['tasks'], ['view-tasks']])
    },
  })
}

export function useUploadAttachmentFromDrop() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('upload the attachment'),
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
      if (!result.success) throw apiError(result)
      return result.data
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      refreshTasks(qc, [['tasks'], ['view-tasks']])
    },
  })
}

export function useUploadAttachmentFromPaste(options?: MutationHookOptions) {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('upload the image', options),
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
    }): Promise<{ attachmentId: number }> => {
      // Snapshot current attachment IDs so we can identify the new one after upload.
      const beforeResult = await api.fetchTaskAttachments(taskId)
      const beforeIds = new Set<number>(
        beforeResult.success ? beforeResult.data.map((a) => a.id) : []
      )

      const uploadResult = await api.uploadTaskAttachment(taskId, fileData, fileName, mimeType)
      if (!uploadResult.success) throw apiError(uploadResult)

      // Refetch and find the new attachment. If multiple new entries appear, prefer
      // the one matching fileName; otherwise take the highest ID.
      const afterResult = await api.fetchTaskAttachments(taskId)
      if (!afterResult.success) throw apiError(afterResult)

      const newAttachments = afterResult.data.filter((a) => !beforeIds.has(a.id))
      const byName = newAttachments.find((a) => a.file.name === fileName)
      const picked = byName ?? newAttachments.sort((a, b) => b.id - a.id)[0]
      if (!picked) throw new Error('Upload succeeded but new attachment not found')

      return { attachmentId: picked.id }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      refreshTasks(qc, [['tasks'], ['view-tasks']])
    },
  })
}

export function useDeleteAttachment() {
  const qc = useQueryClient()

  return useMutation({
    meta: metaFor('delete the attachment'),
    mutationFn: async ({ taskId, attachmentId }: { taskId: number; attachmentId: number }) => {
      const result = await api.deleteTaskAttachment(taskId, attachmentId)
      if (!result.success) throw apiError(result)
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['task-attachments', vars.taskId] })
      refreshTasks(qc, [['tasks'], ['view-tasks']])
    },
  })
}
