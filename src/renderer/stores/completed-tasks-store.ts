import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'

export interface CompletedTaskEntry {
  task: Task
  path: string
  /** Original unfinished descendants changed by the parent's completion cascade. */
  autoCompletedSubtasks?: Task[]
  /** Nested rows stay inside their parent instead of being injected as top-level undo rows. */
  suppressTopLevelUndo?: boolean
}

interface CompletedTasksState {
  tasks: Map<number, CompletedTaskEntry>
  add: (
    task: Task,
    path: string,
    autoCompletedSubtasks?: Task[],
    suppressTopLevelUndo?: boolean,
  ) => void
  update: (taskId: number, partial: Partial<Task>) => void
  remove: (taskId: number) => void
  clear: () => void
  /** A task created offline got its real id. */
  remapTaskIds: (idMap: ReadonlyMap<number, number>) => void
}

export const useCompletedTasksStore = create<CompletedTasksState>((set) => ({
  tasks: new Map(),
  add: (task, path, autoCompletedSubtasks, suppressTopLevelUndo) =>
    set((state) => {
      const next = new Map(state.tasks)
      next.set(task.id, { task, path, autoCompletedSubtasks, suppressTopLevelUndo })
      return { tasks: next }
    }),
  update: (taskId, partial) =>
    set((state) => {
      const entry = state.tasks.get(taskId)
      if (!entry) return state
      const next = new Map(state.tasks)
      next.set(taskId, { ...entry, task: { ...entry.task, ...partial } })
      return { tasks: next }
    }),
  remove: (taskId) =>
    set((state) => {
      if (!state.tasks.has(taskId)) return state
      const next = new Map(state.tasks)
      next.delete(taskId)
      return { tasks: next }
    }),
  clear: () => set({ tasks: new Map() }),
  remapTaskIds: (idMap) =>
    set((state) => {
      if (![...state.tasks.keys()].some((id) => idMap.has(id))) return state
      const next = new Map<number, CompletedTaskEntry>()
      for (const [id, entry] of state.tasks) {
        const realId = idMap.get(id)
        next.set(realId ?? id, realId === undefined ? entry : { ...entry, task: { ...entry.task, id: realId } })
      }
      return { tasks: next }
    }),
}))
