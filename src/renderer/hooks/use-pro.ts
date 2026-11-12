import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AppConfig } from '@/lib/vikunja-types'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from './use-app-config'
import { isProEnabled, readProLayers, type ProLayer, type ProLayers } from '../../shared/pro/settings'

/**
 * Pro's switch and layers on this device (cross-app semantics 21.1). `on` is false in standalone
 * mode. Off, nothing of Pro shows (decision 2).
 */
export function usePro(): { on: boolean; layers: ProLayers; layer: (layer: ProLayer) => boolean; config: AppConfig | undefined } {
  const { data: config } = useAppConfig()
  return useMemo(() => {
    const on = isProEnabled(config ?? null)
    const layers = readProLayers(config?.pro_layers)
    return { on, layers, layer: (layer: ProLayer) => on && layers[layer], config: config ?? undefined }
  }, [config])
}

/** Saves Pro's device settings as a patch, shown at once. */
export function useSaveProConfig() {
  const queryClient = useQueryClient()
  return useCallback(
    (patch: Partial<AppConfig>) => {
      const current = queryClient.getQueryData<AppConfig>(APP_CONFIG_QUERY_KEY)
      if (current) queryClient.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, ...patch })
      return api.saveConfigPatch(patch)
    },
    [queryClient],
  )
}
