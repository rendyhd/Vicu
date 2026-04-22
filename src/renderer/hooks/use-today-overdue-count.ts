import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { isOverdue, isToday } from '@/lib/date-utils'

export function useTodayOverdueCount(): number {
  const params = useFilters({ view: 'today' })
  const { data: tasks = [] } = useTasks(params)
  return useMemo(() => {
    let n = 0
    for (const t of tasks) {
      if (t.done) continue
      if (isOverdue(t.due_date) || isToday(t.due_date)) n++
    }
    return n
  }, [tasks])
}
