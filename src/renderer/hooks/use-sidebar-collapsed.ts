import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from '@/hooks/use-app-config'
import type { AppConfig } from '@/lib/vikunja-types'

/** The new list of collapsed project ids after `id` is collapsed or expanded. */
export function toggleCollapsed(collapsed: readonly number[], id: number, collapse: boolean): number[] {
  const rest = collapsed.filter((known) => known !== id)
  return collapse ? [...rest, id].sort((a, b) => a - b) : rest
}

/**
 * Which sidebar projects are collapsed. Everything is expanded until the person collapses it; the
 * choice is saved in the config (a partial patch, so nothing else in it is touched).
 */
export function useSidebarCollapsed() {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const collapsed = useMemo(() => new Set(config?.sidebar_collapsed_projects ?? []), [config?.sidebar_collapsed_projects])

  const setCollapsed = useCallback(
    (id: number, collapse: boolean) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      const next = toggleCollapsed(current?.sidebar_collapsed_projects ?? [], id, collapse)
      // Show the change at once; the patch is merged into the config in main.
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, sidebar_collapsed_projects: next })
      void api.saveConfigPatch({ sidebar_collapsed_projects: next })
    },
    [qc],
  )

  return { collapsed, setCollapsed }
}

/** Whether Pro's sidebar section is collapsed to its header (per device, saved in the config). */
export function useProSectionCollapsed() {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const collapsed = config?.sidebar_pro_collapsed === true

  const setCollapsed = useCallback(
    (collapse: boolean) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, sidebar_pro_collapsed: collapse })
      void api.saveConfigPatch({ sidebar_pro_collapsed: collapse })
    },
    [qc],
  )

  return { collapsed, setCollapsed }
}

/**
 * Which sidebar categories are collapsed (cross-app semantics 13.3: per device, never synced).
 * Saved in the config like the collapsed projects.
 */
export function useCollapsedCategories() {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const collapsed = useMemo(() => new Set(config?.sidebar_collapsed_categories ?? []), [config?.sidebar_collapsed_categories])

  const setCollapsed = useCallback(
    (id: string, collapse: boolean) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      const rest = (current?.sidebar_collapsed_categories ?? []).filter((known) => known !== id)
      const next = collapse ? [...rest, id].sort() : rest
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, sidebar_collapsed_categories: next })
      void api.saveConfigPatch({ sidebar_collapsed_categories: next })
    },
    [qc],
  )

  return { collapsed, setCollapsed }
}
