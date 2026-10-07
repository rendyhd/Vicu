import { create } from 'zustand'

/**
 * Minimal error notice for the Review screen. There is no app-wide mutation
 * error UI yet, and a failed review save used to be completely silent.
 */
interface ReviewNoticeState {
  error: { id: number; message: string } | null
  showError: (message: string) => void
  clearError: () => void
}

let nextId = 1

export const useReviewNoticeStore = create<ReviewNoticeState>((set) => ({
  error: null,
  showError: (message) => set({ error: { id: nextId++, message } }),
  clearError: () => set({ error: null }),
}))
