import { useMemo } from 'react'
import { usePro } from './use-pro'
import { useProLedger } from './use-pro-ledger'
import { useProjects } from './use-projects'
import { useTasks } from './use-tasks'
import { OPEN_TASKS_PARAMS, useAvailability } from './use-availability'
import type { Task } from '@/lib/vikunja-types'
import { estimateOf } from '../../shared/pro/ledger'
import { rankedInitiatives } from '../../shared/pro/portfolio'
import { focusBlockCandidates, focusBlockMinutes } from '../../shared/pro/focus-block'

export interface FocusBlockProposal {
  tasks: Task[]
  minutes: number
}

/**
 * The daily focus block (cross-app semantics 21.11, plan 7.7.4): one 60 to 90 minute block for the
 * work that moves the top initiatives, which Plan my day proposes first. Available open tasks in a
 * ranked initiative (or one of its subprojects), then flagged ones. Null without Pro's power layer
 * or without a candidate.
 */
export function useFocusBlock(canChange: (task: Task) => boolean): FocusBlockProposal | null {
  const pro = usePro()
  const on = pro.layer('power')
  const portfolio = pro.layer('portfolio')
  const { ledger } = useProLedger()
  const { data: projects } = useProjects()
  const { data: open = [] } = useTasks(OPEN_TASKS_PARAMS, on)
  const availability = useAvailability()
  return useMemo(() => {
    if (!on) return null
    const ranks = new Map(portfolio ? rankedInitiatives(ledger).map((entry) => [entry.projectId, entry.rank] as const) : [])
    const parent = new Map((projects?.all ?? []).map((project) => [project.id, project.parent_project_id]))
    const rankOf = (projectId: number): number | null => {
      const seen = new Set<number>()
      for (let id: number | null | undefined = projectId; typeof id === 'number' && id > 0 && !seen.has(id); id = parent.get(id)) {
        if (ranks.has(id)) return ranks.get(id)!
        seen.add(id)
      }
      return null
    }
    const eligible = open.filter((task) => !task.done && canChange(task) && (availability.of(task)?.available ?? true))
    const ids = focusBlockCandidates(eligible, rankOf)
    if (ids.length === 0) return null
    const byId = new Map(eligible.map((task) => [task.id, task]))
    const tasks = ids.map((id) => byId.get(id)!).filter(Boolean)
    return { tasks, minutes: focusBlockMinutes(tasks.map((task) => estimateOf(ledger, task.id))) }
  }, [on, portfolio, ledger, projects?.all, open, availability, canChange])
}
