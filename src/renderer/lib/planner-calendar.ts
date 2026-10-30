import type { Task } from '@/lib/vikunja-types'
import type { CalDavEvent } from '../../shared/caldav-types'
import { addLocalDays, startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import { PLANNER_DEFAULT_DURATION_MINUTES, plannerTaskSortKey } from '@/lib/planner'
import { parseTaskDuration } from '@/lib/task-duration'
import { DAY_SLOT_HEIGHT_PX, DAY_SLOT_MINUTES } from '@/lib/day-calendar'
import { localDateString, occurrencesForDate, type RoutineCarrier, type RoutineOccurrence } from '@/lib/routines'

const MINUTE_MS = 60_000
const DAY_MINUTES = 24 * 60
/** Minimum readable height for short blocks, also used when assigning overlap columns. */
export const CALENDAR_EVENT_MIN_HEIGHT_PX = 24
const MIN_EVENT_MINUTES = CALENDAR_EVENT_MIN_HEIGHT_PX * DAY_SLOT_MINUTES / DAY_SLOT_HEIGHT_PX

export interface PlannerCalendarEvent extends CalendarGeometry {
  caldav?: never
  task: Task
  /** Routine blocks refer to a carrier, never an editable task schedule. */
  routine?: RoutineOccurrence<Task>
}

interface CalendarGeometry {
  /** Real instants; display bounds are clipped to the selected local day. */
  start: Date
  end: Date
  /** Display bounds in the fixed 24-hour wall-clock grid, clipped to this day. */
  startMinute: number
  endMinute: number
  column: number
  columnCount: number
}

export interface CalDavCalendarBlock extends CalendarGeometry {
  caldav: CalDavEvent
  task?: never
  routine?: never
}

export type CalendarBlock = PlannerCalendarEvent | CalDavCalendarBlock

export function calendarBlockKey(event: CalendarBlock): string {
  return event.caldav ? `caldav:${event.caldav.occurrenceKey}` : event.routine ? `routine:${event.routine.key}:${event.start.getTime()}` : `task:${event.task.id}`
}

export function calDavCalendarBlocks(events: readonly CalDavEvent[], day: Date): CalDavCalendarBlock[] {
  const dayStart = startOfLocalDay(toLocalDate(day))
  const dayEnd = startOfLocalDay(addLocalDays(toLocalDate(day), 1))
  return events.filter((event) => !event.allDay).flatMap((caldav) => {
    const start = new Date(caldav.start)
    const end = new Date(caldav.end)
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end < start || start >= dayEnd || (end > start ? end <= dayStart : start < dayStart)) return []
    const startMinute = Math.min(start < dayStart ? 0 : wallMinute(start), DAY_MINUTES - MIN_EVENT_MINUTES)
    const endMinute = Math.min(DAY_MINUTES, Math.max(end >= dayEnd ? DAY_MINUTES : wallMinute(end), startMinute + MIN_EVENT_MINUTES))
    return [{ caldav, start, end, startMinute, endMinute, column: 0, columnCount: 1 }]
  })
}

export interface PlannerCalendarEvents {
  timed: PlannerCalendarEvent[]
}

const wallMinute = (date: Date): number => date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60

/** Greedy interval partitioning; a connected overlap group shares its maximum column count. */
export function layoutCalendarOverlaps<T extends CalendarBlock>(events: T[]): T[] {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute
    || (a.task && b.task ? a.task.id - b.task.id : calendarBlockKey(a).localeCompare(calendarBlockKey(b))))
  const result: T[] = []
  let group: T[] = []
  let columnEnds: number[] = []
  let groupEnd = -1
  const flush = () => {
    result.push(...group.map((event) => ({ ...event, columnCount: columnEnds.length })))
    group = []
    columnEnds = []
  }

  for (const event of sorted) {
    if (event.startMinute >= groupEnd) flush()
    let column = columnEnds.findIndex((end) => end <= event.startMinute)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = event.endMinute
    group.push({ ...event, column })
    groupEnd = Math.max(...columnEnds)
  }
  flush()
  return result
}

/**
 * Map tasks with a start_date and scheduled routine occurrences to the selected local day,
 * including overlapping overnight blocks. Routines use their slot times, regardless of reminders.
 * Routines require explicit duration; tasks without it default to 30 minutes.
 * Task due_date and end_date are never involved.
 */
export function plannerCalendarEvents(
  tasks: readonly Task[],
  activeProjectIds: ReadonlySet<number>,
  day: Date,
  routines: readonly RoutineCarrier<Task>[] = [],
  today = localDateString(),
): PlannerCalendarEvents {
  const date = toLocalDate(day)
  const dayStart = startOfLocalDay(date).getTime()
  const dayEnd = startOfLocalDay(addLocalDays(date, 1)).getTime()
  const timed: PlannerCalendarEvent[] = []
  const candidates: { task: Task; startMs: number; routine?: RoutineOccurrence<Task> }[] = tasks
    .filter((task) => activeProjectIds.has(task.project_id))
    .flatMap((task) => {
      const startMs = plannerTaskSortKey(task)
      return startMs === null ? [] : [{ task, startMs }]
    })

  for (const carrier of routines) {
    if (carrier.payload.definition.archived) continue
    const duration = parseTaskDuration(carrier.task.description)
    if (duration === null) continue
    // Include earlier occurrences whose elapsed duration can spill into the selected day.
    const earliest = new Date(dayStart - duration * MINUTE_MS)
    if (!Number.isFinite(earliest.getTime())) continue
    let occurrenceDate = toLocalDate(earliest)
    if (occurrenceDate < carrier.payload.definition.activeFrom) occurrenceDate = carrier.payload.definition.activeFrom
    for (; occurrenceDate <= date; occurrenceDate = addLocalDays(occurrenceDate, 1)) {
      for (const routine of occurrencesForDate(carrier, occurrenceDate, today)) {
        const start = startOfLocalDay(occurrenceDate)
        start.setMinutes(routine.slot.reminderMinutes)
        candidates.push({ task: carrier.task, startMs: start.getTime(), routine })
      }
    }
  }

  for (const { task, startMs, routine } of candidates) {
    const duration = parseTaskDuration(task.description) ?? PLANNER_DEFAULT_DURATION_MINUTES
    const endMs = startMs + duration * MINUTE_MS
    const start = new Date(startMs)
    const end = new Date(endMs)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue
    if (startMs >= dayEnd || endMs <= dayStart) continue

    const startMinute = startMs < dayStart ? 0 : wallMinute(start)
    const endMinute = endMs >= dayEnd ? DAY_MINUTES : wallMinute(end)
    // Repeated DST hours share a line. A backwards wall-clock interval still gets a visible marker.
    const displayStart = Math.min(startMinute, DAY_MINUTES - MIN_EVENT_MINUTES)
    timed.push({
      task, start, end, ...(routine ? { routine } : {}),
      startMinute: displayStart,
      endMinute: Math.min(DAY_MINUTES, Math.max(endMinute, displayStart + MIN_EVENT_MINUTES)),
      column: 0,
      columnCount: 1,
    })
  }

  return { timed: layoutCalendarOverlaps(timed) }
}
