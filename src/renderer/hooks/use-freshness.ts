import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { createFreshness } from '@/lib/freshness'
import { DATE_QUERY_KEYS, refreshTasks } from '@/lib/task-refresh'
import { useDayStore } from '@/stores/day-store'

/**
 * Keep the main window's data fresh (D-FRESH-1): refetch on window focus (throttled) and every five
 * minutes while visible, and roll the date-dependent views over at local midnight and after the
 * computer resumes from sleep. Mount once, in the app shell.
 */
export function useFreshness(): void {
  const qc = useQueryClient()

  useEffect(() => {
    const freshness = createFreshness({
      now: () => new Date(),
      refresh: () => {
        refreshTasks(qc)
      },
      onDayChange: (dayKey) => {
        // Views that compute "today" from their own clock re-read it through the day key; the
        // queries themselves are refetched so nothing keeps yesterday's overdue / due-today sets.
        useDayStore.getState().setDayKey(dayKey)
        refreshTasks(qc, DATE_QUERY_KEYS)
      },
      isVisible: () => document.visibilityState === 'visible',
    })
    freshness.start()

    const onFocus = () => freshness.onFocus()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') freshness.onVisible()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    const offResume = api.onAppResumed(() => freshness.onResume())

    return () => {
      freshness.stop()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      offResume()
    }
  }, [qc])
}
