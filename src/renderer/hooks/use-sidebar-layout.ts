import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from '@/hooks/use-app-config'
import { useSmartLists, type SmartListItem } from '@/components/sidebar/SmartListNav'
import { useProNavItems } from '@/components/sidebar/ProNav'
import { isHiddenFromSidebar, type AppConfig } from '@/lib/vikunja-types'
import {
  arrangeableSidebar,
  isDefaultSidebarOrder,
  isSidebarView,
  sidebarGroups,
  sidebarOrderAfterArranging,
  type SidebarBlock,
  type SidebarEntry,
} from '../../shared/sidebar-layout'

/** A stretch of the sidebar as it is drawn: smart lists with their names, or a block. */
export type SidebarSection =
  | { kind: 'views'; key: string; items: SmartListItem[]; pinned: boolean }
  | { kind: 'block'; key: string; block: SidebarBlock }

/** Everything that exists now and can be arranged: the smart lists that are on, and the blocks. */
function useOffered(): { offered: Set<string>; lists: Map<string, SmartListItem> } {
  const smartLists = useSmartLists()
  const hasPro = useProNavItems().length > 0
  return useMemo(() => {
    const lists = new Map(smartLists.map((item) => [item.id as string, item]))
    const offered = new Set<string>([...lists.keys(), 'projects', 'lists', 'labels'])
    if (hasPro) offered.add('pro')
    return { offered, lists }
  }, [smartLists, hasPro])
}

/**
 * The sidebar top to bottom, in the person's order (Settings → General → Sidebar): the smart lists
 * that are on and not hidden, and the blocks. The lists under the last block are `pinned`.
 */
export function useSidebarSections(): SidebarSection[] {
  const { data: config } = useAppConfig()
  const { offered, lists } = useOffered()
  const order = config?.sidebar_order
  const hidden = config?.sidebar_hidden_lists
  return useMemo(() => {
    const shown = new Set([...offered].filter((entry) => !isSidebarView(entry) || !isHiddenFromSidebar({ sidebar_hidden_lists: hidden }, entry)))
    return sidebarGroups(order, shown).map((group): SidebarSection =>
      group.kind === 'block'
        ? { kind: 'block', key: group.block, block: group.block }
        : { kind: 'views', key: group.views[0], items: group.views.flatMap((view) => lists.get(view) ?? []), pinned: group.pinned })
  }, [order, hidden, offered, lists])
}

/** What Settings arranges, and how an arrangement is saved (a partial patch, shown at once). */
export function useSidebarArrangement() {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const { offered, lists } = useOffered()
  const order = config?.sidebar_order
  const entries = useMemo(() => arrangeableSidebar(order, offered), [order, offered])

  const save = useCallback(
    (next: string[]) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, sidebar_order: next })
      void api.saveConfigPatch({ sidebar_order: next })
    },
    [qc],
  )

  const arrange = useCallback(
    (arranged: readonly SidebarEntry[]) => {
      const current = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      save(sidebarOrderAfterArranging(current?.sidebar_order, arranged))
    },
    [qc, save],
  )
  const reset = useCallback(() => save([]), [save])

  return { entries, lists, isDefault: isDefaultSidebarOrder(order), arrange, reset }
}
