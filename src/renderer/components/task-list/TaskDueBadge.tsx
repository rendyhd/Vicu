import { cn } from '@/lib/cn'
import { isNullDate, formatDueDate } from '@/lib/date-utils'
import { isDueToday, isOverdue } from '@/lib/due-dates'

interface TaskDueBadgeProps {
  dueDate: string
  className?: string
}

export function TaskDueBadge({ dueDate, className }: TaskDueBadgeProps) {
  if (isNullDate(dueDate)) return null

  // Date, plus the time of day when the due date has an explicit time.
  const label = formatDueDate(dueDate)
  const overdue = isOverdue(dueDate)
  const today = isDueToday(dueDate)

  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium',
        overdue && 'bg-accent-red/10 text-accent-red',
        today && !overdue && 'bg-accent-orange/10 text-accent-orange',
        !overdue && !today && 'text-[var(--text-secondary)]',
        className
      )}
    >
      {label}
    </span>
  )
}
