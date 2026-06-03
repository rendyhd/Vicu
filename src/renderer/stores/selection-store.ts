import { create } from 'zustand'

interface SelectionState {
  expandedTaskId: number | null
  focusedTaskId: number | null
  /** Multi-selection of task ids — separate from the single focused/expanded task. */
  selectedTaskIds: Set<number>
  /** Anchor row for shift-click range selection. */
  selectionAnchorId: number | null
  setExpandedTask: (id: number | null) => void
  toggleExpandedTask: (id: number) => void
  setFocusedTask: (id: number | null) => void
  collapseAll: () => void
  toggleSelected: (id: number) => void
  selectOnly: (id: number) => void
  setSelectedRange: (ids: number[]) => void
  clearSelection: () => void
  setSelectionAnchor: (id: number | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  expandedTaskId: null,
  focusedTaskId: null,
  selectedTaskIds: new Set(),
  selectionAnchorId: null,

  setExpandedTask: (id) => set({ expandedTaskId: id }),

  toggleExpandedTask: (id) =>
    set((state) => ({
      expandedTaskId: state.expandedTaskId === id ? null : id,
    })),

  setFocusedTask: (id) => set({ focusedTaskId: id }),

  collapseAll: () => set({ expandedTaskId: null }),

  // Always assign a NEW Set so React re-renders subscribers.
  toggleSelected: (id) =>
    set((state) => {
      const next = new Set(state.selectedTaskIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedTaskIds: next, selectionAnchorId: id }
    }),

  selectOnly: (id) => set({ selectedTaskIds: new Set([id]), selectionAnchorId: id }),

  setSelectedRange: (ids) => set({ selectedTaskIds: new Set(ids) }),

  clearSelection: () => set({ selectedTaskIds: new Set(), selectionAnchorId: null }),

  setSelectionAnchor: (id) => set({ selectionAnchorId: id }),
}))
