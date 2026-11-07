import { create } from 'zustand'
import { runTaskTransition, transitionIds } from '@/lib/task-transition'

/** A subtask opened from its parent's card: its row is shown under the parent's row. */
export interface OpenedSubtask {
  parentId: number
  id: number
}

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
  /**
   * The subtasks opened from a card ("Open" on a subtask), outermost first. Lists leave subtasks out,
   * so a parent row shows the ones listed here as rows of their own under it until another task opens.
   */
  openedSubtasks: OpenedSubtask[]
  /** A task made from a template: its title is selected when its card opens, once. */
  selectTitleTaskId: number | null
  selectTitleOf: (id: number | null) => void
  setExpandedTask: (id: number | null) => void
  toggleExpandedTask: (id: number) => void
  /** Open a subtask of the task whose card shows it: the card closes and the subtask opens under it. */
  openSubtask: (parentId: number, id: number) => void
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

type Get = () => SelectionState
type SetState = (partial: Partial<SelectionState>) => void

/** The task a running open/close transition is about to expand (its state change is applied a moment later). */
let requested: { id: number | null } | null = null

/** The expanded task as the user last asked for it, before a running transition has applied it. */
function expandedNow(get: Get): number | null {
  return requested ? requested.id : get().expandedTaskId
}

/**
 * The expanded task as the user last asked for it. Key handlers read this instead of
 * `getState().expandedTaskId`, which still shows the old task while an open/close transition has not
 * applied its change yet (two handlers for one key press would otherwise disagree).
 */
export const currentExpandedTaskId = (): number | null => expandedNow(useSelectionStore.getState)

function expand(get: Get, set: SetState, next: number | null): void {
  const current = expandedNow(get)
  if (current === next) return
  // Opening any other task puts the opened subtasks away; closing one keeps its row where it is.
  const { openedSubtasks } = get()
  if (next !== null && openedSubtasks.length > 0 && !openedSubtasks.some((entry) => entry.id === next)) {
    set({ openedSubtasks: [] })
  }
  const request = { id: next }
  requested = request
  runTaskTransition(transitionIds(current, next), () => {
    set({ expandedTaskId: next })
    if (requested === request) requested = null
  })
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  expandedTaskId: null,
  focusedTaskId: null,
  pendingOpenTaskId: null,
  selectedTaskIds: new Set(),
  selectionAnchorId: null,
  openedSubtasks: [],

  // Opening, closing and switching the expanded task go through the open/close transition (lib/task-transition.ts).
  selectTitleTaskId: null,

  selectTitleOf: (id) => set({ selectTitleTaskId: id }),

  setExpandedTask: (id) => expand(get, set, id),

  toggleExpandedTask: (id) => expand(get, set, expandedNow(get) === id ? null : id),

  openSubtask: (parentId, id) => {
    // A subtask of an opened subtask goes one level deeper; any other parent starts a new trail.
    const trail = get().openedSubtasks
    const at = trail.findIndex((entry) => entry.id === parentId)
    set({ openedSubtasks: [...trail.slice(0, at + 1), { parentId, id }], focusedTaskId: id })
    expand(get, set, id)
  },

  setFocusedTask: (id) => set({ focusedTaskId: id }),

  requestOpenTask: (id) => set({ pendingOpenTaskId: id }),

  openRequestedTask: (id) =>
    set((state) => (state.pendingOpenTaskId === id ? { expandedTaskId: id, focusedTaskId: id, pendingOpenTaskId: null } : state)),

  clearOpenRequest: (id) => set((state) => (state.pendingOpenTaskId === id ? { pendingOpenTaskId: null } : state)),

  collapseAll: () => expand(get, set, null),

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
