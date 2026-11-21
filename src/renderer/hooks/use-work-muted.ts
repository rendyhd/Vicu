import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkTask } from '../../shared/work-scope'
import { useWorkMode } from './use-work-mode'

/**
 * The tasks a timeline still draws although the mode does not list them (cross-app semantics 22.4:
 * time blocks of the other mode stay, because they are busy time). Maps each task id to the name of
 * its mode ("Personal", "Work") for the muted drawing and its accessible label. Undefined in All,
 * so a timeline without the feature draws exactly as before.
 */
export function useWorkMuted(tasks: ReadonlyArray<WorkTask & { id: number }>): ReadonlyMap<number, string> | undefined {
  const { t } = useTranslation()
  const { mode, passes, isWork } = useWorkMode()
  return useMemo(() => {
    if (mode === 'all') return undefined
    const muted = new Map<number, string>()
    for (const task of tasks) {
      if (!passes(task)) muted.set(task.id, isWork(task) ? t('workMode.work') : t('workMode.personal'))
    }
    return muted
  }, [mode, tasks, passes, isWork, t])
}
