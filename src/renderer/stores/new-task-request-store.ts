import { create } from 'zustand'

/** How long a request waits for a list that can take it (a route change in between is fine). */
export const NEW_TASK_REQUEST_TTL_MS = 3000

interface NewTaskRequestState {
  /** When a "new task" was asked for and no list has taken it yet; null when nothing waits. */
  requestedAt: number | null
  /** Ask the list on screen to open its composer (the command palette does this). */
  request: (now?: number) => void
  /** A list that opens its composer takes the request; true when there was a fresh one. */
  take: (now?: number) => boolean
}

export const useNewTaskRequestStore = create<NewTaskRequestState>((set, get) => ({
  requestedAt: null,
  request: (now = Date.now()) => set({ requestedAt: now }),
  take: (now = Date.now()) => {
    const at = get().requestedAt
    if (at === null) return false
    set({ requestedAt: null })
    return now - at <= NEW_TASK_REQUEST_TTL_MS
  },
}))
