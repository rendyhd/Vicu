import { create } from 'zustand'
import { toast } from '@/stores/toast-store'
import type { IcsImportPreview } from '../../shared/ics-import'

// Importing a calendar file (contract 20.10): the preview waits here, so its dialog is drawn by a
// host outside the Plan gear's popover (ImportCalendarHost), whichever button started it.

interface CalendarImportState {
  preview: IcsImportPreview | null
  reading: boolean
  /** Main opens the file dialog and reads the file; a problem is said in a toast. */
  pick: () => Promise<void>
  close: () => void
}

export const useCalendarImportStore = create<CalendarImportState>((set, get) => ({
  preview: null,
  reading: false,
  pick: async () => {
    if (get().reading) return
    set({ reading: true })
    try {
      const result = await window.api.calendar.importFile()
      if (!result.success) toast.error(result.error)
      else if (result.data) set({ preview: result.data })
    } finally {
      set({ reading: false })
    }
  },
  close: () => set({ preview: null }),
}))
