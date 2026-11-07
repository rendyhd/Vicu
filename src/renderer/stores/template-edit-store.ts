import { create } from 'zustand'

interface TemplateEditState {
  /** The template being edited (section 18.3), wherever Edit was chosen. */
  editingId: string | null
  open: (id: string) => void
  close: () => void
}

export const useTemplateEditStore = create<TemplateEditState>((set) => ({
  editingId: null,
  open: (id) => set({ editingId: id }),
  close: () => set({ editingId: null }),
}))
