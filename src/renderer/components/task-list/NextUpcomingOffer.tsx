import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateDisplay } from '@/lib/date-display'
import { isUpcoming } from '@/lib/due-dates'

/**
 * What Today offers when it is empty (card 4.11a): the next task that is due after today, with its
 * day, as a button to Upcoming. One request for a single task (the server sorts by due date), made
 * only while Today is empty. Renders nothing while it loads or when nothing is upcoming.
 */
export function NextUpcomingOffer() {
  const navigate = useNavigate()
  const dateFormat = useDateFormat()
  const upcoming = useFilters({ view: 'upcoming' })
  const params = useMemo(() => ({ ...upcoming, page: 1, per_page: 1 }), [upcoming])
  const { data: tasks = [] } = useTasks(params)
  const next = tasks.find((task) => isUpcoming(task.due_date, new Date()))
  if (!next) return null
  const day = formatDateDisplay('header.day', new Date(next.due_date), new Date(), true, dateFormat)
  return (
    <button
      type="button"
      data-next-upcoming
      onClick={() => navigate({ to: '/upcoming' })}
      className="flex max-w-full items-center gap-2 rounded-control px-3 py-1.5 text-meta text-text-secondary hover:bg-[var(--bg-hover)] hover:text-text"
    >
      <span className="shrink-0">Next up</span>
      <span className="min-w-0 truncate font-medium text-text">{next.title}</span>
      <span className="shrink-0">{day}</span>
      <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
    </button>
  )
}
