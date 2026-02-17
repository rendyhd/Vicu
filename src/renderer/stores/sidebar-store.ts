import { create } from 'zustand'

interface SidebarState {
  activeView: string
  expandedAreas: Set<number>
  sidebarWidth: number
  projectDialogOpen: boolean
  labelDialogOpen: boolean
  setActiveView: (view: string) => void
  toggleArea: (id: number) => void
  setSidebarWidth: (width: number) => void
  setProjectDialogOpen: (open: boolean) => void
  setLabelDialogOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  activeView: 'inbox',
  expandedAreas: new Set<number>(),
  sidebarWidth: 240,
  projectDialogOpen: false,
  labelDialogOpen: false,

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
  setProjectDialogOpen: (open) => set({ projectDialogOpen: open }),
  setLabelDialogOpen: (open) => set({ labelDialogOpen: open }),
}))

export function useSidebarActions() {
  const setProjectDialogOpen = useSidebarStore((s) => s.setProjectDialogOpen)
  const setLabelDialogOpen = useSidebarStore((s) => s.setLabelDialogOpen)

  return {
    openProjectDialog: () => setProjectDialogOpen(true),
    openLabelDialog: () => setLabelDialogOpen(true),
  }
}
