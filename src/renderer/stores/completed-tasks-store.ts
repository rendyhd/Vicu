import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'

interface CompletedTaskEntry {
  task: Task
  path: string
}

interface CompletedTasksState {
  tasks: Map<number, CompletedTaskEntry>
  add: (task: Task, path: string) => void
  update: (taskId: number, partial: Partial<Task>) => void
  remove: (taskId: number) => void
  clear: () => void
}

export const useCompletedTasksStore = create<CompletedTasksState>((set) => ({
  tasks: new Map(),
  add: (task, path) =>
    set((state) => {
      const next = new Map(state.tasks)
      next.set(task.id, { task, path })
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
}))
