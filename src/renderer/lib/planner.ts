import type { Task } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import {
  addLocalDays,
  diffLocalDays,
  localDateOf,
  startOfLocalDay,
  startOfLocalDayIso,
  toLocalDate,
  type LocalDate,
} from '@/lib/due-dates'

export const PLANNER_DAY_COUNT = 3
export const PLANNER_DEFAULT_DURATION_MINUTES = 30

/** Available Planner width, excluding the sidebar. Columns stretch between these breakpoints. */
export function plannerVisibleDayCount(width: number): number {
  if (width > 1420) return PLANNER_DAY_COUNT
  if (width > 870) return 2
  return 1
}

export interface PlannerDay {
  /** Null identifies the Overdue column; dated columns carry their local calendar date. */
  date: LocalDate | null
  tasks: Task[]
}

/**
 * The start-date window (completed included) plus all open tasks. Never fetch all completed history.
 * Vikunja cannot match its zero-time "no date" value, so select unplanned tasks client-side from
 * all open tasks. Due dates have no bearing on Planner membership, including completed tasks.
 */
export function plannerTaskFilter(windowStart: Date): string {
  const start = startOfLocalDayIso(0, windowStart)
  const end = startOfLocalDayIso(PLANNER_DAY_COUNT, windowStart)
  return `done = false || (start_date >= '${start}' && start_date < '${end}')`
}

/** A picked date must still have a visible heading in the displayed window after resizing. */
export function plannerCalendarDate(selected: LocalDate | null, windowStart: Date, visibleDayCount = PLANNER_DAY_COUNT): LocalDate {
  const firstDay = toLocalDate(windowStart)
  return selected && selected >= firstDay && selected < addLocalDays(firstDay, visibleDayCount)
    ? selected
    : firstDay
}

/** Preserve an existing start time; a day-only drop of an unplanned task starts at local midnight. */
export function plannerStartDateOnDrop(startDate: string, targetDate: LocalDate): string | null {
  const currentDate = plannerTimestamp(startDate) === null ? null : localDateOf(startDate)
  if (!currentDate) return startOfLocalDay(targetDate).toISOString()
  if (currentDate === targetDate) return null
  // Start times are always real times, including midnight and 23:59:59. Do not apply the
  // date-only/legacy-midnight normalization used by due-date moves.
  const moved = new Date(startDate)
  moved.setDate(moved.getDate() + diffLocalDays(currentDate, targetDate))
  return moved.toISOString()
}

function plannerTimestamp(value: string | null | undefined): number | null {
  if (!value || value === NULL_DATE) return null
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

/** Only a valid start_date makes a task planned; due/end dates and duration never affect order. */
export function plannerTaskSortKey(task: Task): number | null {
  return plannerTimestamp(task.start_date)
}

function comparePlannerTasks(left: Task, right: Task): number {
  const leftKey = plannerTaskSortKey(left)
  const rightKey = plannerTaskSortKey(right)
  if (leftKey === null) return rightKey === null ? 0 : 1
  if (rightKey === null) return -1
  return leftKey - rightKey
}

/** Open tasks in active projects without a valid start date, regardless of their due date. */
export function plannerUnplannedTasks(tasks: Task[], activeProjectIds: ReadonlySet<number>): Task[] {
  return tasks.filter((task) => (
    !task.done
    && activeProjectIds.has(task.project_id)
    && plannerTimestamp(task.start_date) === null
  ))
}

/** Group the displayed dates and open overdue tasks outside that window; always return four columns. */
export function groupPlannerTasks(
  tasks: Task[],
  activeProjectIds: ReadonlySet<number>,
  now: Date,
  windowStart: LocalDate = toLocalDate(now),
): PlannerDay[] {
  const today = toLocalDate(now)
  const overdueTasks: Task[] = []
  const days: PlannerDay[] = Array.from({ length: PLANNER_DAY_COUNT }, (_, offset) => ({
    date: addLocalDays(windowStart, offset),
    tasks: [],
  }))
  const byDate = new Map(days.map((day) => [day.date, day.tasks]))

  // Stable sorting preserves the existing order for equal start times.
  for (const task of [...tasks].sort(comparePlannerTasks)) {
    if (!activeProjectIds.has(task.project_id)) continue
    const startDate = plannerTaskSortKey(task) === null ? null : localDateOf(task.start_date)
    if (!startDate) continue
    const dayTasks = byDate.get(startDate)
    if (dayTasks) dayTasks.push(task)
    else if (startDate < today && !task.done) overdueTasks.push(task)
  }

  return [{ date: null, tasks: overdueTasks }, ...days]
}
