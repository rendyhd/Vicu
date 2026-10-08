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
        'shrink-0 rounded px-1.5 py-0.5 text-meta font-medium',
        overdue && 'bg-status-overdue/8 text-status-overdue',
        today && !overdue && 'text-status-today',
        !overdue && !today && 'text-text-secondary',
        className
      )}
    >
      {label}
    </span>
  )
}
