import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { countTodayOverdue } from '@/lib/today-overdue'
import { useDayKey } from '@/stores/day-store'

/**
 * The count for the app icon badge: open tasks that are overdue or due today, in active projects
 * (archived projects are not counted, the Today view does not show them either). Null until the
 * project list is known, so the badge is not cleared and redrawn during startup. `dayKey` is a
 * dependency, so the count is recomputed at local midnight and after the computer resumes (see
 * useFreshness), even when no task changed.
 */
export function useTodayOverdueCount(): number | null {
  const params = useFilters({ view: 'today' })
  const dayKey = useDayKey()
  const { data: tasks = [] } = useTasks(params)
  const { data: projects } = useProjects()
  return useMemo(() => {
    if (!projects) return null
    const activeIds = new Set(projects.flat.map((project) => project.id))
    return countTodayOverdue(tasks, activeIds, new Date())
  }, [tasks, projects, dayKey])
}
