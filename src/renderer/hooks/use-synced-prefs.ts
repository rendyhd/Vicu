import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import { APP_CONFIG_QUERY_KEY } from './use-app-config'
import type { AppConfig, Project } from '@/lib/vikunja-types'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'
import { t } from '../../shared/i18n'

/**
 * The synced preferences (cross-app semantics section 11), as the main process keeps them: every
 * entry's value by key, and the Inbox in use. Read with `readSyncedPref` / `resolveTaskOrder`.
 */
export const SYNCED_PREFS_QUERY_KEY = ['synced-prefs'] as const

const EMPTY: SyncedPrefsSnapshot = { values: {}, inboxProjectId: 0 }

export function useSyncedPrefs() {
  const query = useQuery({
    queryKey: SYNCED_PREFS_QUERY_KEY,
    queryFn: () => api.getSyncedPrefs(),
    staleTime: Infinity,
  })
  return { ...query, snapshot: query.data ?? EMPTY }
}

/** Writes a synced setting (`null`: back to the default, on every device). */
export function useSetSyncedPreference() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api.setSyncedPreference(key, value),
    onMutate: ({ key, value }) => {
      // The local copy changes at once in main; show it before the answer arrives.
      const previous = queryClient.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)
      if (previous) queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, { ...previous, values: { ...previous.values, [key]: value } })
      return { previous }
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, snapshot)
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, context.previous)
    },
  })
}

/**
 * Writes several synced settings in one change (`null`: back to the default, on every device),
 * shown at once. Not tied to a component, so a menu that closes before the answer still gets its
 * change applied. False (and an error toast) when main refused it.
 */
export async function writeSyncedPrefs(queryClient: QueryClient, values: Record<string, unknown>): Promise<boolean> {
  if (Object.keys(values).length === 0) return true
  const previous = queryClient.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)
  if (previous) queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, { ...previous, values: { ...previous.values, ...values } })
  try {
    queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, await api.setSyncedPreferences(values))
    return true
  } catch (error) {
    if (previous) queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, previous)
    const reason = error instanceof Error ? error.message : ''
    toast.error(reason ? t('sync.prefs.saveFailedReason', { reason }) : t('sync.prefs.saveFailed'))
    return false
  }
}

/**
 * Follows changes from the main process (another device's choice arrived with a sync). Mounted once,
 * in AppShell. When the Inbox changed, the app config is read again (every view reads the Inbox from
 * it); when this device switched to the account's Inbox on its first sync, it says so once.
 */
export function useSyncedPrefsEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => api.onSyncedPrefsChanged((snapshot) => {
    queryClient.setQueryData(SYNCED_PREFS_QUERY_KEY, snapshot)
    const config = queryClient.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
    if (config && config.inbox_project_id !== snapshot.inboxProjectId) {
      queryClient.setQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY, { ...config, inbox_project_id: snapshot.inboxProjectId })
      void queryClient.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
    }
    if (snapshot.adoptedInbox !== undefined) {
      const projects = queryClient.getQueryData<Project[]>(['projects'])
      const name = projects?.find((project) => project.id === snapshot.adoptedInbox)?.title
      toast.info(name ? t('sync.prefs.inboxSyncsUsing', { name }) : t('sync.prefs.inboxSyncs'))
    }
  }), [queryClient])
}
