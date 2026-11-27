import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { can } from '@/lib/capabilities'
import { isRefreshKey, manualRefresh } from '@/lib/manual-refresh'
import { appRefreshDeps } from '@/lib/task-refresh'
import { announce } from '@/stores/announcer-store'
import { invalidateCalendars } from '@/hooks/use-calendar-events'
import { t } from '../../shared/i18n'

/** Refresh the page now, with the app's queue state; says so to screen readers. */
export function refreshNow(qc: QueryClient): void {
  const outcome = manualRefresh(qc, {
    ...appRefreshDeps,
    syncDocuments: () => {
      void Promise.resolve(api.syncCustomLists()).catch(() => {})
      void Promise.resolve(api.syncSyncedPrefs()).catch(() => {})
    },
    refreshCalendars: () => {
      if (!can('calendars')) return
      void Promise.resolve(window.api.calendar.refresh())
        .catch(() => {})
        .then(() => invalidateCalendars(qc))
    },
  })
  announce(outcome === 'deferred' ? t('app.refreshingDeferred') : t('app.refreshing'))
}

/** F5 and View → Refresh (Mod+R) in the main window. Mount once, in the app shell. */
export function useManualRefresh(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRefreshKey(event)) return
      event.preventDefault()
      refreshNow(qc)
    }
    window.addEventListener('keydown', onKeyDown)
    const offMenu = api.onRefreshView(() => refreshNow(qc))
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      offMenu()
    }
  }, [qc])
}
