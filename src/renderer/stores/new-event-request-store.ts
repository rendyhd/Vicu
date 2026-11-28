import { create } from 'zustand'
import { NEW_TASK_REQUEST_TTL_MS } from './new-task-request-store'

// "New event" from the command palette: the Plan screen takes it once it is on screen and opens the
// title box at the selected day's next free time, as Ctrl+Shift+N does there.

interface NewEventRequestState {
  requestedAt: number | null
  request: (now?: number) => void
  /** The Plan screen takes the request; true when there was a fresh one. */
  take: (now?: number) => boolean
}

export const useNewEventRequestStore = create<NewEventRequestState>((set, get) => ({
  requestedAt: null,
  request: (now = Date.now()) => set({ requestedAt: now }),
  take: (now = Date.now()) => {
    const at = get().requestedAt
    if (at === null) return false
    set({ requestedAt: null })
    return now - at <= NEW_TASK_REQUEST_TTL_MS
  },
}))
