import { splitToday } from '../../shared/time-blocks'

interface DatedTask {
  project_id: number
  done: boolean
  due_date: string
  start_date?: string | null
  end_date?: string | null
}

/**
 * Split tasks into Overdue and the Today section, by the shared rules (a date-only due date is local
 * 23:59:59 and counts for its whole day, and a block starting today is on Today) and by what the
 * Today view shows: tasks of archived or unknown projects are left out. `now` is a parameter so the
 * split moves with the local day, not with a data change.
 */
export function splitTodayOverdue<T extends DatedTask>(
  tasks: readonly T[],
  activeProjectIds: ReadonlySet<number>,
  now: Date,
): { overdue: T[]; today: T[] } {
  return splitToday(tasks.filter((task) => activeProjectIds.has(task.project_id)), now)
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
