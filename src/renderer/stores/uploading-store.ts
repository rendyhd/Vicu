import { create } from 'zustand'
import type { UploadingFile } from '@/lib/uploading-files'

/**
 * The files the attach dialog is sending (the task's attachments popover and the card's paperclip
 * count read them), and "plan.pdf attached" for a screen reader after one lands.
 */
interface UploadingState {
  uploads: UploadingFile[]
  notice: { taskId: number; text: string } | null
  add: (uploads: readonly UploadingFile[]) => void
  /** The server made [attachmentId]: the row stays until the lists have it, then goes. */
  land: (key: number, attachmentId: number) => void
  remove: (key: number) => void
  announce: (taskId: number, text: string) => void
}

/** How long a landed upload is kept for a list that has not been read again yet (the card's count). */
export const LANDED_KEEP_MS = 10_000

/** How long the screen reader's notice stays. */
export const NOTICE_MS = 5_000

export const useUploadingStore = create<UploadingState>((set, get) => ({
  uploads: [],
  notice: null,
  add: (uploads) => set((state) => ({ uploads: [...state.uploads, ...uploads] })),
  land: (key, attachmentId) => {
    set((state) => ({ uploads: state.uploads.map((u) => (u.key === key ? { ...u, attachmentId } : u)) }))
    setTimeout(() => get().remove(key), LANDED_KEEP_MS)
  },
  remove: (key) => set((state) => ({ uploads: state.uploads.filter((u) => u.key !== key) })),
  announce: (taskId, text) => {
    const notice = { taskId, text }
    set({ notice })
    setTimeout(() => {
      if (get().notice === notice) set({ notice: null })
    }, NOTICE_MS)
  },
}))
