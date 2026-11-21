import { useTranslation } from 'react-i18next'
import { useWorkMode } from '@/hooks/use-work-mode'

/**
 * The mode's name on a row of a list the mode does not filter (Search, cross-app semantics 22.4): a
 * task that the Work or Personal mode would not list says which one it is in. A word, never colour
 * alone. Nothing in All, and nothing for a task the mode lists.
 */
export function useWorkMark(task: { project_id?: number | null; labels?: ReadonlyArray<{ id: number }> | null }, enabled: boolean): boolean {
  const { mode, passes } = useWorkMode()
  return enabled && mode !== 'all' && !passes(task)
}

export function WorkMark({ task }: { task: { project_id?: number | null; labels?: ReadonlyArray<{ id: number }> | null } }) {
  const { t } = useTranslation()
  const { isWork } = useWorkMode()
  return (
    <span className="vicu-chip shrink-0 rounded-chip bg-bg-hover px-2 py-px text-chip leading-tight text-text-secondary" data-work-mark>
      {isWork(task) ? t('workMode.work') : t('workMode.personal')}
    </span>
  )
}

/**
 * The same mark for a result outside a task row (command palette, Quick find): `other` is the mode
 * the result belongs to, which is never the mode on screen. Results are never filtered.
 */
export function WorkModeWord({ other }: { other: 'work' | 'personal' }) {
  const { t } = useTranslation()
  return (
    <span className="vicu-chip shrink-0 rounded-chip bg-bg-hover px-2 py-px text-chip leading-tight text-text-secondary" data-work-mark>
      {other === 'work' ? t('workMode.work') : t('workMode.personal')}
    </span>
  )
}

/** The mode a palette or Quick find result belongs to when it is not the one on screen, else null. */
export function useOtherModeOf(): (result: { task?: { project_id?: number | null; labels?: ReadonlyArray<{ id: number }> | null }; projectId?: number }) => 'work' | 'personal' | null {
  const { mode, passes, shownProjects } = useWorkMode()
  return (result) => {
    if (mode === 'all') return null
    const outside = result.task ? !passes(result.task) : result.projectId !== undefined && shownProjects !== null && !shownProjects.has(result.projectId)
    return outside ? (mode === 'work' ? 'personal' : 'work') : null
  }
}
