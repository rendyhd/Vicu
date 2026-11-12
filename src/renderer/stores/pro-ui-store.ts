import { create } from 'zustand'
import type { Task } from '@/lib/vikunja-types'

/**
 * Pro's dialogs and pickers that the palette and shortcuts open from anywhere (plan 7.1.11).
 * Each is drawn once by its host in AppShell.
 */
export type ProDialog = 'pro-import' | 'pro-copilot' | 'pro-recap'

interface ProUiState {
  focusPickerOpen: boolean
  setFocusPickerOpen: (open: boolean) => void
  /** The Pro dialog on screen, with what it starts from (pasted text, a person, a meeting round). */
  dialog: ProDialog | null
  dialogInput: { text?: string; personId?: number; roundId?: string; projectId?: number } | null
  open: (dialog: ProDialog, input?: ProUiState['dialogInput']) => void
  close: () => void
  /** An initiative to start once one is parked (the cap is full). */
  atCapStart: number | null
  setAtCapStart: (projectId: number | null) => void
  /** A request being triaged (21.10). */
  triageTask: Task | null
  setTriageTask: (task: Task | null) => void
  /** The selection's inspector (Mod+I, plan 7.7.2). */
  inspectorOpen: boolean
  setInspectorOpen: (open: boolean) => void
}

export const useProUiStore = create<ProUiState>((set) => ({
  focusPickerOpen: false,
  setFocusPickerOpen: (open) => set({ focusPickerOpen: open }),
  dialog: null,
  dialogInput: null,
  open: (dialog, input = null) => set({ dialog, dialogInput: input }),
  close: () => set({ dialog: null, dialogInput: null }),
  atCapStart: null,
  setAtCapStart: (projectId) => set({ atCapStart: projectId }),
  triageTask: null,
  setTriageTask: (task) => set({ triageTask: task }),
  inspectorOpen: false,
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
}))
