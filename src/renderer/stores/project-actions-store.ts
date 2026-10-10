import { create } from 'zustand'
import type { Project } from '@/lib/vikunja-types'

/** Where a project menu was opened: the sidebar tree, the Settings project list or a project page. */
export type ProjectSurface = 'sidebar' | 'settings' | 'page'

/** The dialog the project menu opened (one at a time, drawn by ProjectActionsHost). */
export type ProjectDialogRequest =
  | { kind: 'create'; parentId: number }
  | { kind: 'edit'; project: Project }
  | { kind: 'cadence'; project: Project }

interface ProjectActionsState {
  dialog: ProjectDialogRequest | null
  /** Where focus goes when the dialog closes (the row or button the menu came from). */
  returnFocusTo: HTMLElement | null
  /** The project being renamed in place, and on which surface. */
  renaming: { id: number; surface: ProjectSurface } | null
  /** An editable "new project" row in the sidebar: the parent it is created under (0 = top level). */
  creating: { parentId: number } | null
}

export const useProjectActionsStore = create<ProjectActionsState>(() => ({
  dialog: null,
  returnFocusTo: null,
  renaming: null,
  creating: null,
}))

/** For menus and keyboard handlers: open a dialog or start editing a row in place. */
export const projectActions = {
  openDialog(dialog: ProjectDialogRequest, returnFocusTo: HTMLElement | null = null) {
    useProjectActionsStore.setState({ dialog, returnFocusTo })
  },
  closeDialog() {
    useProjectActionsStore.setState({ dialog: null, returnFocusTo: null })
  },
  startRename(id: number, surface: ProjectSurface) {
    useProjectActionsStore.setState({ renaming: { id, surface }, creating: null })
  },
  stopRename() {
    useProjectActionsStore.setState({ renaming: null })
  },
  startCreate(parentId: number) {
    useProjectActionsStore.setState({ creating: { parentId }, renaming: null })
  },
  stopCreate() {
    useProjectActionsStore.setState({ creating: null })
  },
}
