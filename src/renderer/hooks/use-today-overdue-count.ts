import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { isDueToday, isOverdue } from '@/lib/due-dates'

export function useTodayOverdueCount(): number {
  const params = useFilters({ view: 'today' })
  const { data: tasks = [] } = useTasks(params)
  return useMemo(() => {
    let n = 0
    const now = new Date()
    for (const t of tasks) {
      if (t.done) continue
      if (isOverdue(t.due_date, now) || isDueToday(t.due_date, now)) n++
    }
    return n
  }, [tasks])
}
