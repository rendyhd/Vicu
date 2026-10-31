import { useMemo } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { ICON_NONE, projectIconKey, projectsWithoutIcon } from '../../shared/synced-prefs'
import { useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'

/**
 * The projects drawn without their folder icon (cross-app semantics 11.3): where one is drawn, the
 * name starts where the icon would be.
 */
export function useProjectsWithoutIcon(): ReadonlySet<number> {
  const { snapshot } = useSyncedPrefs()
  return useMemo(() => projectsWithoutIcon(snapshot.values), [snapshot.values])
}

/** Draws a project with its folder (the default) or without an icon, on every device of the account. */
export function setProjectShowIcon(queryClient: QueryClient, projectId: number, show: boolean): Promise<boolean> {
  return writeSyncedPrefs(queryClient, { [projectIconKey(projectId)]: show ? null : ICON_NONE })
}
