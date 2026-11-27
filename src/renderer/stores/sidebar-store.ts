import { create } from 'zustand'
import { api } from '@/lib/api'
import { SIDEBAR_DEFAULT_WIDTH } from '@/lib/sidebar-width'

interface SidebarState {
  activeView: string
  expandedAreas: Set<number>
  sidebarWidth: number
  labelDialogOpen: boolean
  /** Whether the Archived group under the sidebar projects is open (for this session). */
  archivedProjectsOpen: boolean
  /** The window is too narrow for the sidebar beside the content: it is a drawer (lib/sidebar-width.ts). */
  narrow: boolean
  /** The drawer is open (a narrow window only; never saved). */
  drawerOpen: boolean
  /** The person hid the sidebar in a wide window (config `sidebar_hidden`, per device). */
  hiddenWhenWide: boolean
  setActiveView: (view: string) => void
  toggleArea: (id: number) => void
  setSidebarWidth: (width: number) => void
  setLabelDialogOpen: (open: boolean) => void
  setArchivedProjectsOpen: (open: boolean) => void
  setNarrow: (narrow: boolean) => void
  setDrawerOpen: (open: boolean) => void
  setHiddenWhenWide: (hidden: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  activeView: 'inbox',
  expandedAreas: new Set<number>(),
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  labelDialogOpen: false,
  archivedProjectsOpen: false,
  narrow: false,
  drawerOpen: false,
  hiddenWhenWide: false,

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
  // A window that gets wide again closes the drawer, so it is closed the next time it is narrow.
  setNarrow: (narrow) => {
    if (get().narrow !== narrow) set({ narrow, drawerOpen: false })
  },
  setDrawerOpen: (open) => {
    if (get().drawerOpen !== open) set({ drawerOpen: open })
  },
  setHiddenWhenWide: (hidden) => set({ hiddenWhenWide: hidden }),
}))

/**
 * The sidebar button, Mod+\ and the palette: open or close the drawer in a narrow window, show or
 * hide the sidebar in a wide one (remembered on this device).
 */
export function toggleSidebar(): void {
  const state = useSidebarStore.getState()
  if (state.narrow) {
    state.setDrawerOpen(!state.drawerOpen)
    return
  }
  const hidden = !state.hiddenWhenWide
  state.setHiddenWhenWide(hidden)
  void api.saveConfigPatch({ sidebar_hidden: hidden })
}

/** Closes the drawer after something in it was chosen (a list, a Settings tab). Nothing in a wide window. */
export function closeSidebarDrawer(): void {
  useSidebarStore.getState().setDrawerOpen(false)
}

export function useSidebarActions() {
  const setLabelDialogOpen = useSidebarStore((s) => s.setLabelDialogOpen)

  return {
    openLabelDialog: () => setLabelDialogOpen(true),
  }
}
