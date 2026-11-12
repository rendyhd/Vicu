import { useCallback, useMemo } from 'react'
import { usePro } from './use-pro'
import { useProLedger } from './use-pro-ledger'
import { useProjects } from './use-projects'
import { recordValue } from '../../shared/pro/ledger'

/**
 * Parked initiatives leave Today and Upcoming (cross-app semantics 21.10): the projects of a parked
 * initiative and their subprojects. Without the portfolio layer this keeps every task, with one
 * identity, so the lists do not recompute.
 */
export function useParkedFilter(): <T extends { project_id: number }>(tasks: T[]) => T[] {
  const on = usePro().layer('portfolio')
  const { ledger } = useProLedger()
  const { data: projects } = useProjects()
  const parked = useMemo(() => {
    if (!on) return null
    const roots = Object.keys(ledger.initiatives).map(Number).filter((id) => recordValue(ledger.initiatives, id)?.status === 'parked')
    if (roots.length === 0) return null
    const parent = new Map((projects?.all ?? []).map((project) => [project.id, project.parent_project_id]))
    const held = new Set<number>()
    for (const project of projects?.all ?? []) {
      let current: number | null | undefined = project.id
      const seen = new Set<number>()
      while (typeof current === 'number' && current > 0 && !seen.has(current)) {
        if (roots.includes(current)) {
          held.add(project.id)
          break
        }
        seen.add(current)
        current = parent.get(current)
      }
    }
    return held
  }, [on, ledger.initiatives, projects?.all])
  return useCallback(<T extends { project_id: number }>(tasks: T[]): T[] => (parked ? tasks.filter((task) => !parked.has(task.project_id)) : tasks), [parked])
}
