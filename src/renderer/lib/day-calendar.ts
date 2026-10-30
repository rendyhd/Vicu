// The wall-clock grid behind the Planner's right-side day calendar (docs/calendar.md).

export const DAY_SLOT_MINUTES = 30
export const DAY_SLOT_COUNT = (24 * 60) / DAY_SLOT_MINUTES
/** Height of one 30-minute block in px (an hour is 72 px). DayViewCalendar renders it as an inline
 * height so its scroll-to-open math shares the one constant. */
export const DAY_SLOT_HEIGHT_PX = 36
/** The slot the day opens at for any day other than today: the 8 AM hour line. */
const DAY_OPEN_SLOT_INDEX = (8 * 60) / DAY_SLOT_MINUTES

export interface DayTimeSlot {
  /** Minutes from local midnight: 0, 30, 60, ... 1410. */
  minutesFromMidnight: number
  /** The slot starts an hour: its line is the more solid one and only hours carry a label. */
  isHour: boolean
  /** A clock-only formatting reference, not an instant on the displayed day (which may skip an hour). */
  labelTime: Date
  /** Local ISO minute precision ("2026-06-10T09:00") for a `<time dateTime>`. */
  isoLocal: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * The 48 half-hour slots of one local day, in order. `dayStart` is any instant of that local day
 * (normally `startOfLocalDay`). Labels use a fixed reference date, not the displayed date: a
 * spring-forward day's nonexistent 02:00 must still label the 02:00 wall-clock grid line.
 */
export function dayTimeSlots(dayStart: Date): DayTimeSlot[] {
  const year = dayStart.getFullYear()
  const month = dayStart.getMonth()
  const date = dayStart.getDate()
  const isoDay = `${year}-${pad2(month + 1)}-${pad2(date)}`
  return Array.from({ length: DAY_SLOT_COUNT }, (_, index) => {
    const minutesFromMidnight = index * DAY_SLOT_MINUTES
    return {
      minutesFromMidnight,
      isHour: minutesFromMidnight % 60 === 0,
      labelTime: new Date(2000, 0, 15, 0, minutesFromMidnight),
      isoLocal: `${isoDay}T${pad2(Math.floor(minutesFromMidnight / 60))}:${pad2(minutesFromMidnight % 60)}`,
    }
  })
}

/**
 * The slot the day calendar opens at (docs/calendar.md): for today the 30-minute block containing
 * an hour before now (clamped to the start of the day), for any other day the 8 AM hour line.
 */
export function dayOpenSlotIndex(isToday: boolean, now: Date): number {
  if (!isToday) return DAY_OPEN_SLOT_INDEX
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  return Math.max(0, Math.floor((minutesNow - 60) / DAY_SLOT_MINUTES))
}
