import { create } from 'zustand'
import { localDayKey } from '@/lib/freshness'

/**
 * The local calendar day the views are showing (`YYYY-MM-DD`). It changes at local midnight and
 * after the computer resumes from sleep (see `createFreshness`). A view that computes a window from
 * "today" (Today, Upcoming, a custom list's date filter, the overdue badge) lists it as a
 * dependency, so it recomputes when the day rolls over instead of keeping yesterday's boundaries.
 */
interface DayState {
  dayKey: string
  setDayKey: (dayKey: string) => void
}

export const useDayStore = create<DayState>((set) => ({
  dayKey: localDayKey(new Date()),
  setDayKey: (dayKey) => set((state) => (state.dayKey === dayKey ? state : { dayKey })),
}))

/** The current local day key; a dependency for anything derived from today's date. */
export function useDayKey(): string {
  return useDayStore((s) => s.dayKey)
}
