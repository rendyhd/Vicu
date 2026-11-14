/**
 * A routine's trend (docs/cross-app-semantics-v1.md section 6.11): the state of each day for the
 * month of marks in its history, the run of done days, the last 30 days, twelve weeks of bars and
 * the summary line. Pure, the same rules as Android's `RoutineTrend.kt`; the `trend` vectors of
 * test-fixtures/routine-archive-v1.json pin it.
 */

import { addLocalDays, startOfWeek, type LocalDate } from './due-dates'
import {
  completionDate,
  isCalendarScheduled,
  type OccurrenceStatus,
  type RoutineDefinition,
  type RoutineOccurrenceRecord,
} from './routines'

export const TREND_WINDOW_DAYS = 30
export const TREND_WEEKS = 12
export const TREND_NO_HISTORY = 'No history yet'

export type TrendDayState = 'none' | 'done' | 'part' | 'skipped' | 'missed' | 'open'

/** One time of the routine on a day: its status there, and the record behind it when there is one. */
export interface TrendOccurrence {
  slotId: string
  minutes: number
  status: OccurrenceStatus
  record?: RoutineOccurrenceRecord
}

/** Completed occurrences, and how many were expected: the completed and the missed ones. */
export interface TrendTally {
  done: number
  expected: number
}

export interface RoutineTrend {
  /**
   * What a day holds, in time order: for a schedule one occurrence per slot that ran or has a
   * record, for an after-completion routine what was done or skipped that day, or on today what is
   * due. Also what the day picked lists beside the month.
   */
  occurrencesOn(date: LocalDate): TrendOccurrence[]
  state(date: LocalDate): TrendDayState
  /** The run of done days up to today, or null for an after-completion routine, which has none. */
  streak: number | null
  /** The last 30 days, today included. Nothing is expected of an after-completion routine. */
  window: TrendTally
  /** The twelve Monday weeks that end with today's, oldest first; null for an after-completion routine. */
  weeks: TrendTally[] | null
  /** The line over the month, the same words in both apps. */
  summary: string
}

function stateOf(occurrences: TrendOccurrence[]): TrendDayState {
  let done = 0
  let skipped = 0
  let missed = 0
  let open = 0
  for (const occurrence of occurrences) {
    if (occurrence.status === 'COMPLETED') done++
    else if (occurrence.status === 'SKIPPED') skipped++
    else if (occurrence.status === 'NOT_LOGGED') missed++
    else open++
  }
  if (done + skipped + missed + open === 0) return 'none'
  if (done + missed + open === 0) return 'skipped'
  if (done > 0 && missed + open === 0) return 'done'
  if (done > 0) return 'part'
  if (open > 0) return 'open'
  return 'missed'
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * `records` is the routine's whole history (the carrier and its archive parts) and `today` the
 * local day. A record that names no time zone counts in the device's.
 */
export function routineTrend(
  definition: RoutineDefinition,
  records: readonly RoutineOccurrenceRecord[],
  today: LocalDate,
): RoutineTrend {
  const schedule = definition.schedule
  const calendar = schedule.type === 'calendar' ? schedule : null

  // The records that count on each day: a completion of an after-completion routine on the day it was done.
  const byDay = new Map<LocalDate, RoutineOccurrenceRecord[]>()
  let latestCompletion: LocalDate | undefined
  let everCompleted = false
  for (const record of records) {
    const completed = record.status === 'COMPLETED'
    if (completed) everCompleted = true
    const done = completed ? completionDate(record) : undefined
    if (done && (!latestCompletion || done > latestCompletion)) latestCompletion = done
    const date = !calendar && completed ? done : DATE_PATTERN.test(record.scheduledDate) ? record.scheduledDate : undefined
    if (!date) continue
    const list = byDay.get(date)
    if (list) list.push(record)
    else byDay.set(date, [record])
  }

  // The due date of an after-completion routine while it is due and neither done nor skipped.
  let openDue: LocalDate | undefined
  if (schedule.type === 'after_completion') {
    const due = latestCompletion ? addLocalDays(latestCompletion, Math.max(1, schedule.intervalDays)) : schedule.firstDueDate
    const skipped = records.some((record) => record.status === 'SKIPPED' && record.scheduledDate === due)
    if (DATE_PATTERN.test(due) && due <= today && !skipped) openDue = due
  }

  const activeFrom = DATE_PATTERN.test(definition.activeFrom) ? definition.activeFrom : undefined
  // The routine's first day: the earlier of activeFrom and its earliest record.
  let firstDay = activeFrom ?? today
  for (const date of byDay.keys()) if (date < firstDay) firstDay = date

  const byMinutes = (left: TrendOccurrence, right: TrendOccurrence) => left.minutes - right.minutes

  function occurrencesOn(date: LocalDate): TrendOccurrence[] {
    if (date > today) return []
    const dayRecords = byDay.get(date) ?? []
    if (!calendar) {
      const logged = dayRecords
        .filter((record) => record.status === 'COMPLETED' || record.status === 'SKIPPED')
        .map((record) => ({ slotId: record.slotId, minutes: record.scheduledMinutes, status: record.status, record }))
        .sort(byMinutes)
      if (logged.length > 0) return logged
      if (date === today && openDue) {
        return definition.slots
          .map((slot) => ({ slotId: slot.id, minutes: slot.reminderMinutes, status: 'PENDING' as OccurrenceStatus }))
          .sort(byMinutes)
      }
      return []
    }
    const scheduled = (!activeFrom || date >= activeFrom) && isCalendarScheduled(calendar, date)
    const slotIds: string[] = []
    if (scheduled) for (const slot of definition.slots) slotIds.push(slot.id)
    for (const record of dayRecords) if (!slotIds.includes(record.slotId)) slotIds.push(record.slotId)
    return slotIds
      .map((slotId) => {
        const record = dayRecords.find((entry) => entry.slotId === slotId)
        const stored: OccurrenceStatus = record?.status ?? 'PENDING'
        return {
          slotId,
          minutes: definition.slots.find((slot) => slot.id === slotId)?.reminderMinutes ?? record?.scheduledMinutes ?? 0,
          // Without a record, or still pending, it is missed before today (section 6.7).
          status: stored === 'PENDING' && date < today ? ('NOT_LOGGED' as OccurrenceStatus) : stored,
          record,
        }
      })
      .sort(byMinutes)
  }

  const state = (date: LocalDate): TrendDayState => stateOf(occurrencesOn(date))

  function tally(from: LocalDate, to: LocalDate): TrendTally {
    let done = 0
    let missed = 0
    const end = to < today ? to : today
    for (let date = from > firstDay ? from : firstDay; date <= end; date = addLocalDays(date, 1)) {
      for (const occurrence of occurrencesOn(date)) {
        if (occurrence.status === 'COMPLETED') done++
        else if (occurrence.status === 'NOT_LOGGED') missed++
      }
    }
    return { done, expected: done + missed }
  }

  let streak: number | null = null
  if (calendar) {
    streak = 0
    for (let date = today; date >= firstDay; date = addLocalDays(date, -1)) {
      const day = state(date)
      if (day === 'done') streak++
      else if (day === 'missed' || (day === 'part' && date < today)) break
    }
  }

  const window = tally(addLocalDays(today, -(TREND_WINDOW_DAYS - 1)), today)

  let weeks: TrendTally[] | null = null
  if (calendar) {
    const thisMonday = startOfWeek(today)
    weeks = []
    for (let back = TREND_WEEKS - 1; back >= 0; back--) {
      const monday = addLocalDays(thisMonday, -7 * back)
      weeks.push(tally(monday, addLocalDays(monday, 6)))
    }
  }

  let summary: string
  if (!calendar) {
    if (!everCompleted) summary = TREND_NO_HISTORY
    else if (window.done === 0) summary = `Not done in the last ${TREND_WINDOW_DAYS} days`
    else if (window.done === 1) summary = `Done once in the last ${TREND_WINDOW_DAYS} days`
    else summary = `Done ${window.done} times in the last ${TREND_WINDOW_DAYS} days`
  } else if (window.done === 0 && window.expected === 0) {
    summary = TREND_NO_HISTORY
  } else {
    const run = streak ?? 0
    summary = `${run >= 2 ? `${run} in a row · ` : ''}${window.done} of ${window.expected} in the last ${TREND_WINDOW_DAYS} days`
  }

  return { occurrencesOn, state, streak, window, weeks, summary }
}
