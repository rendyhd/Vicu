import { useCallback, useMemo } from 'react'
import { usePro, useSaveProConfig } from './use-pro'
import { useProjects } from './use-projects'
import { useSyncedPrefs } from './use-synced-prefs'
import { useAppConfig } from './use-app-config'
import { inFocus, projectsShownInFocus, readProFocus, type ProFocus } from '../../shared/pro/focus'
import type { AreaProject } from '../../shared/pro/settings'

const CATEGORY_OF_PROJECT = 'category.project.'

/**
 * Focus (cross-app semantics 21.14): a device-only view of some categories and projects. While it
 * is set (and Pro's availability layer is on) lists, counts, the sidebar and the palette show tasks
 * of projects in focus only. The Inbox always is.
 */
export function useFocus() {
  const pro = usePro()
  const { data: config } = useAppConfig()
  const { data: projects } = useProjects()
  const { snapshot } = useSyncedPrefs()
  const save = useSaveProConfig()
  const focus: ProFocus | null = pro.layer('availability') ? readProFocus(config?.pro_focus) : null
  const inboxId = config?.inbox_project_id || null

  const value = useMemo(() => {
    const map = new Map<number, AreaProject>((projects?.all ?? []).map((project) => [project.id, project]))
    const categoryOf = (topLevelId: number): string | null => {
      const value = snapshot.values[`${CATEGORY_OF_PROJECT}${topLevelId}`]
      return typeof value === 'string' && value !== '' ? value : null
    }
    return {
      focus,
      active: focus !== null,
      projectInFocus: (projectId: number) => inFocus(projectId, focus, map, categoryOf, inboxId),
      /** The projects the sidebar shows, or null for all. */
      shownProjects: focus ? projectsShownInFocus(focus, map, categoryOf, inboxId) : null,
    }
  }, [focus?.categories.join(), focus?.projects.join(), projects?.all, snapshot.values, inboxId])

  const setFocus = useCallback((next: ProFocus | null) => void save({ pro_focus: next }), [save])
  return { ...value, setFocus }
}

/** Keeps the tasks of projects in focus; all of them while no focus is set. */
export function useFocusFilter(): <T extends { project_id: number }>(tasks: readonly T[]) => T[] {
  const { active, projectInFocus } = useFocus()
  // Without a focus the filter keeps one identity, so lists do not recompute when projects change.
  const test = active ? projectInFocus : null
  return useCallback(
    <T extends { project_id: number }>(tasks: readonly T[]): T[] => (test ? tasks.filter((task) => test(task.project_id)) : (tasks as T[])),
    [test],
  )
}
