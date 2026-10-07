import { create } from 'zustand'

interface SelectionState {
  expandedTaskId: number | null
  focusedTaskId: number | null
  /**
   * A task the main process asked to be shown (a clicked reminder, Quick View's "open in app"). The
   * app goes to the task's list; the row for that task expands itself when it appears.
   */
  pendingOpenTaskId: number | null
  /** Multi-selection of task ids — separate from the single focused/expanded task. */
  selectedTaskIds: Set<number>
  /** Anchor row for shift-click range selection. */
  selectionAnchorId: number | null
  setExpandedTask: (id: number | null) => void
  toggleExpandedTask: (id: number) => void
  setFocusedTask: (id: number | null) => void
  requestOpenTask: (id: number) => void
  /** The row of a requested task calls this once it is on screen: it expands and takes focus. */
  openRequestedTask: (id: number) => void
  /** Give up on a request that was never taken (the task is not in the list that opened). */
  clearOpenRequest: (id: number) => void
  collapseAll: () => void
  toggleSelected: (id: number) => void
  selectOnly: (id: number) => void
  setSelectedRange: (ids: number[]) => void
  clearSelection: () => void
  setSelectionAnchor: (id: number | null) => void
  /** A task created offline got its real id: keep it expanded / focused / selected. */
  remapTaskIds: (idMap: ReadonlyMap<number, number>) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  expandedTaskId: null,
  focusedTaskId: null,
  pendingOpenTaskId: null,
  selectedTaskIds: new Set(),
  selectionAnchorId: null,

  setExpandedTask: (id) => set({ expandedTaskId: id }),

  toggleExpandedTask: (id) =>
    set((state) => ({
      expandedTaskId: state.expandedTaskId === id ? null : id,
    })),

  setFocusedTask: (id) => set({ focusedTaskId: id }),

  requestOpenTask: (id) => set({ pendingOpenTaskId: id }),

  openRequestedTask: (id) =>
    set((state) => (state.pendingOpenTaskId === id ? { expandedTaskId: id, focusedTaskId: id, pendingOpenTaskId: null } : state)),

  clearOpenRequest: (id) => set((state) => (state.pendingOpenTaskId === id ? { pendingOpenTaskId: null } : state)),

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

  remapTaskIds: (idMap) =>
    set((state) => {
      const map = (id: number | null) => (id === null ? null : (idMap.get(id) ?? id))
      const touched =
        [state.expandedTaskId, state.focusedTaskId, state.selectionAnchorId].some((id) => id !== null && idMap.has(id)) ||
        [...state.selectedTaskIds].some((id) => idMap.has(id))
      if (!touched) return state
      return {
        expandedTaskId: map(state.expandedTaskId),
        focusedTaskId: map(state.focusedTaskId),
        selectionAnchorId: map(state.selectionAnchorId),
        selectedTaskIds: new Set([...state.selectedTaskIds].map((id) => idMap.get(id) ?? id)),
      }
    }),
}))
