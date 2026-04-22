import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const APP_CONFIG_QUERY_KEY = ['app-config'] as const

export function useAppConfig() {
  return useQuery({
    queryKey: APP_CONFIG_QUERY_KEY,
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  })
}
