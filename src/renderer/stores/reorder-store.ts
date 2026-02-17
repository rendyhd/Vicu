import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'

interface SectionContext {
  viewId: number
  tasks: Task[]
}

interface ReorderState {
  viewId: number | null
  orderedTasks: Task[]
  sectionContexts: Map<number, SectionContext>
  setReorderContext: (viewId: number | null, tasks: Task[]) => void
  setSectionReorderContext: (projectId: number, viewId: number, tasks: Task[]) => void
  clearSectionContexts: () => void
}

export const useReorderStore = create<ReorderState>((set) => ({
  viewId: null,
  orderedTasks: [],
  sectionContexts: new Map(),
  setReorderContext: (viewId, orderedTasks) => set({ viewId, orderedTasks }),
  setSectionReorderContext: (projectId, viewId, tasks) =>
    set((state) => {
      const next = new Map(state.sectionContexts)
      next.set(projectId, { viewId, tasks })
      return { sectionContexts: next }
    }),
  clearSectionContexts: () => set({ sectionContexts: new Map() }),
}))
