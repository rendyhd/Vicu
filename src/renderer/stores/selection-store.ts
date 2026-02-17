import { create } from 'zustand'

interface SelectionState {
  expandedTaskId: number | null
  focusedTaskId: number | null
  setExpandedTask: (id: number | null) => void
  toggleExpandedTask: (id: number) => void
  setFocusedTask: (id: number | null) => void
  collapseAll: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  expandedTaskId: null,
  focusedTaskId: null,

  setExpandedTask: (id) => set({ expandedTaskId: id }),

  toggleExpandedTask: (id) =>
    set((state) => ({
      expandedTaskId: state.expandedTaskId === id ? null : id,
    })),

  setFocusedTask: (id) => set({ focusedTaskId: id }),

  collapseAll: () => set({ expandedTaskId: null }),
}))
