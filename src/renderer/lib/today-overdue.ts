import { isDueToday, isOverdue } from '@/lib/due-dates'

interface DatedTask {
  project_id: number
  done: boolean
  due_date: string
}

/**
 * Split tasks into Overdue and Due today, by the shared due-date rules (a date-only due date is
 * local 23:59:59 and counts for its whole day) and by what the Today view shows: tasks of archived
 * or unknown projects are left out. `now` is a parameter so the split moves with the local day,
 * not with a data change.
 */
export function splitTodayOverdue<T extends DatedTask>(
  tasks: readonly T[],
  activeProjectIds: ReadonlySet<number>,
  now: Date,
): { overdue: T[]; today: T[] } {
  const overdue: T[] = []
  const today: T[] = []
  for (const task of tasks) {
    if (!activeProjectIds.has(task.project_id)) continue
    if (isOverdue(task.due_date, now)) overdue.push(task)
    else if (isDueToday(task.due_date, now)) today.push(task)
  }
  return { overdue, today }
}

/** The number on the app icon: open tasks that are overdue or due today, in active projects only (D-BADGE-1). */
export function countTodayOverdue<T extends DatedTask>(
  tasks: readonly T[],
  activeProjectIds: ReadonlySet<number>,
  now: Date,
): number {
  const { overdue, today } = splitTodayOverdue(
    tasks.filter((task) => !task.done),
    activeProjectIds,
    now,
  )
  return overdue.length + today.length
}
