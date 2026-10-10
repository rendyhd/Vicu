import { create } from 'zustand'

interface SidebarState {
  activeView: string
  expandedAreas: Set<number>
  sidebarWidth: number
  labelDialogOpen: boolean
  /** Whether the Archived group under the sidebar projects is open (for this session). */
  archivedProjectsOpen: boolean
  setActiveView: (view: string) => void
  toggleArea: (id: number) => void
  setSidebarWidth: (width: number) => void
  setLabelDialogOpen: (open: boolean) => void
  setArchivedProjectsOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  activeView: 'inbox',
  expandedAreas: new Set<number>(),
  sidebarWidth: 240,
  labelDialogOpen: false,
  archivedProjectsOpen: false,

  setActiveView: (view) => set({ activeView: view }),

  toggleArea: (id) =>
    set((state) => {
      const next = new Set(state.expandedAreas)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedAreas: next }
    }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setLabelDialogOpen: (open) => set({ labelDialogOpen: open }),
  setArchivedProjectsOpen: (open) => set({ archivedProjectsOpen: open }),
}))

export function useSidebarActions() {
  const setLabelDialogOpen = useSidebarStore((s) => s.setLabelDialogOpen)

  return {
    openLabelDialog: () => setLabelDialogOpen(true),
  }
}
