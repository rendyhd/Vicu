import { createContext, useContext } from 'react'
import { cn } from '@/lib/cn'
import { isNullDate, formatDueDate } from '@/lib/date-utils'
import { isDueToday, isOverdue } from '@/lib/due-dates'
import { useDateFormat } from '@/hooks/use-date-format'

type DueDateContext = 'row' | 'row.inToday' | 'row.inDayGroup'

/**
 * Where the rows are shown decides how much of the date they repeat (contract section 8.3): Today
 * already says "today", a day group of Upcoming already says the day. Rows default to `row`.
 */
const DueDateContextValue = createContext<DueDateContext>('row')
export const DueDateContextProvider = DueDateContextValue.Provider

interface TaskDueBadgeProps {
  dueDate: string
  className?: string
}

export function TaskDueBadge({ dueDate, className }: TaskDueBadgeProps) {
  const context = useContext(DueDateContextValue)
  const fmt = useDateFormat()
  if (isNullDate(dueDate)) return null

  // Date, plus the time of day when the due date has an explicit time.
  const label = formatDueDate(dueDate, new Date(), fmt, context)
  if (!label) return null
  const overdue = isOverdue(dueDate)
  const today = isDueToday(dueDate)

  return (
    <span
      className={cn(
        'shrink-0 rounded-control px-1.5 py-0.5 text-meta font-medium',
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
