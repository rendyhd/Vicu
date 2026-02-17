import { cn } from '@/lib/cn'
import { isNullDate, isOverdue, isToday, formatRelativeDate } from '@/lib/date-utils'

interface TaskDueBadgeProps {
  dueDate: string
  className?: string
}

export function TaskDueBadge({ dueDate, className }: TaskDueBadgeProps) {
  if (isNullDate(dueDate)) return null

  const label = formatRelativeDate(dueDate)
  const overdue = isOverdue(dueDate)
  const today = isToday(dueDate)

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
