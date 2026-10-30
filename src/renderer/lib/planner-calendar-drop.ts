import { startOfLocalDay } from '@/lib/due-dates'
import { DAY_SLOT_HEIGHT_PX, DAY_SLOT_MINUTES, DAY_SLOT_COUNT } from '@/lib/day-calendar'
import { CALENDAR_SNAP_MINUTES, snapCalendarMinutes } from '@/lib/planner-calendar-edit'

export interface PlannerCalendarDropData {
  type: 'planner-calendar'
  /** Read live pointer/grid coordinates, including any scrolling since the last move. */
  getStartDate: () => string | null
}

/** The pointer marks the new start, not the offset at which the source row was grabbed. */
export function plannerCalendarDropStart(dayKey: string, pointerY: number, gridTop: number): string | null {
  if (!Number.isFinite(pointerY) || !Number.isFinite(gridTop)) return null
  const minute = Math.max(0, Math.min(
    DAY_SLOT_COUNT * DAY_SLOT_MINUTES - CALENDAR_SNAP_MINUTES,
    snapCalendarMinutes((pointerY - gridTop) * DAY_SLOT_MINUTES / DAY_SLOT_HEIGHT_PX),
  ))
  const start = startOfLocalDay(dayKey)
  // Set local wall-clock minutes, rather than elapsed minutes since midnight (DST).
  start.setMinutes(minute, 0, 0)
  return start.toISOString()
}
