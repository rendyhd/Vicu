import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readyFeatures } from '../../shared/ai/settings'
import type { AiSettingsPatch, AiSettingsView, SpeechStatus } from '../../shared/ai/types'
import { readSyncedPlaces } from '../../shared/synced-prefs'
import { useAppConfig } from './use-app-config'
import { useCustomLists } from './use-custom-lists'
import { useLabels } from './use-labels'
import { useCollabMe, useProjectAccessMap } from './use-project-access'
import { useProjects } from './use-projects'
import { useSyncedPrefs } from './use-synced-prefs'
import type { AiWorkspace } from '@/lib/ai/workspace'
import { can } from '@/lib/capabilities'

// The assistant's state in a window (docs/ai-assistant-v1.md): its device settings (read from the
// main process, which owns them and the key), what can run now, the local speech status, and the
// workspace the requests and tools read.

export const AI_SETTINGS_QUERY_KEY = ['ai-settings'] as const
export const SPEECH_STATUS_QUERY_KEY = ['speech-status'] as const

export function useAiSettings() {
  return useQuery<AiSettingsView>({
    queryKey: AI_SETTINGS_QUERY_KEY,
    queryFn: () => window.api.ai.getSettings(),
    enabled: can('assistant'),
    staleTime: Infinity,
  })
}

export function useSaveAiSettings() {
  const queryClient = useQueryClient()
  return async (patch: AiSettingsPatch): Promise<AiSettingsView> => {
    const next = await window.api.ai.saveSettings(patch)
    queryClient.setQueryData(AI_SETTINGS_QUERY_KEY, next)
    return next
  }
}

/** Which features can run: set up, consent given, switched on, model tested (7.1, 2.4). */
export function useAiReady(): { dictation: boolean; ask: boolean; talk: boolean } {
  const { data } = useAiSettings()
  return useMemo(() => (data && can('assistant') ? readyFeatures(data, data.hasKey) : { dictation: false, ask: false, talk: false }), [data])
}

export function useSpeechStatus() {
  return useQuery<SpeechStatus>({
    queryKey: SPEECH_STATUS_QUERY_KEY,
    queryFn: () => window.api.speech.status(),
    enabled: can('assistant'),
    staleTime: 30_000,
  })
}

/** The projects, labels, places, custom lists and access the assistant reads, from the window's caches. */
export function useAiWorkspace(): AiWorkspace {
  const { data: projects } = useProjects()
  const { data: labels } = useLabels()
  const { data: config } = useAppConfig()
  const { data: customLists } = useCustomLists()
  const { snapshot } = useSyncedPrefs()
  const me = useCollabMe()
  const accessMap = useProjectAccessMap()
  return useMemo<AiWorkspace>(() => ({
    projects: projects?.all ?? [],
    inboxProjectId: config?.inbox_project_id ?? 0,
    labels: labels ?? [],
    places: readSyncedPlaces(snapshot.values).map((place) => ({ id: place.id, name: place.name })),
    customLists: customLists ?? [],
    me,
    access: (projectId) => accessMap.get(projectId) ?? { shared: false, members: [], permission: 1 },
  }), [projects?.all, config?.inbox_project_id, labels, snapshot.values, customLists, me, accessMap])
}
