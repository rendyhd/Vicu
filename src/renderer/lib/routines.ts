// Routine rules live in src/shared/routines.ts (shared with the main-process reminders); this
// file adds the renderer-only pieces: device identity, view models and display helpers.
import { toLocalDate } from '../../shared/due-dates'
import {
  routineOccurrenceKey,
  scheduledDateOn,
  type OccurrenceStatus,
  type RoutineDefinition,
  type RoutineOccurrenceRecord,
  type RoutinePayload,
  type RoutineSlot,
  formatInstant,
} from '../../shared/routines'

export * from '../../shared/routines'
export { addLocalDays, isoWeekday } from '../../shared/due-dates'

export const ROUTINE_MARKER_PREFIX = '<!-- vicu-routine:'
export const NULL_DATE = '0001-01-01T00:00:00Z'

export interface RoutineCarrier<TTask = { id: number; description: string }> {
  task: TTask
  payload: RoutinePayload
}

export interface RoutineOccurrence<TTask = { id: number; description: string }> {
  carrier: RoutineCarrier<TTask>
  key: string
  slot: RoutineSlot
  scheduledDate: string
  status: OccurrenceStatus
  loggedAt: string
  note: string
  overdue: boolean
}

/** The device's local calendar date (a thin name kept for the views). */
export function localDateString(value = new Date()): string {
  return toLocalDate(value)
}

export function occurrencesForDate<TTask>(
  carrier: RoutineCarrier<TTask>,
  date: string,
  today = localDateString(),
): RoutineOccurrence<TTask>[] {
  const { definition } = carrier.payload
  const effectiveDate = scheduledDateOn(carrier.payload, date, { today })
  if (effectiveDate === null) return []

  return definition.slots.map((slot) => {
    const key = routineOccurrenceKey(definition.id, effectiveDate, slot.id)
    const record = carrier.payload.occurrences[key]
    let status = record?.status ?? 'PENDING'
    if (status === 'PENDING' && definition.kind === 'HEALTH' && effectiveDate < today) status = 'NOT_LOGGED'
    return {
      carrier,
      key,
      slot,
      scheduledDate: effectiveDate,
      status,
      loggedAt: record?.loggedAt ?? '',
      note: record?.note ?? '',
      overdue: definition.kind === 'CHORE' && status === 'PENDING' && effectiveDate < today,
    }
  })
}

/** Done for the day: completed or skipped. Pending and not-logged occurrences still need attention. */
export function isFinished(status: OccurrenceStatus): boolean {
  return status === 'COMPLETED' || status === 'SKIPPED'
}

export function routineDay<TTask>(carriers: RoutineCarrier<TTask>[], date = localDateString()): RoutineOccurrence<TTask>[] {
  return carriers
    .flatMap((carrier) => occurrencesForDate(carrier, date))
    .sort((left, right) => {
      const leftDone = left.status === 'COMPLETED' ? 1 : 0
      const rightDone = right.status === 'COMPLETED' ? 1 : 0
      return leftDone - rightDone || Number(right.overdue) - Number(left.overdue) ||
        left.slot.reminderMinutes - right.slot.reminderMinutes ||
        left.carrier.payload.definition.name.localeCompare(right.carrier.payload.definition.name)
    })
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function deviceId(): string {
  const key = 'vicu-routine-device-id'
  const existing = localStorage.getItem(key)
  if (existing) return existing
  const id = newId()
  localStorage.setItem(key, id)
  return id
}

export function statusRecord(
  payload: RoutinePayload,
  date: string,
  slot: RoutineSlot,
  status: OccurrenceStatus,
  note = '',
): RoutineOccurrenceRecord {
  const now = formatInstant()
  const id = deviceId()
  const key = routineOccurrenceKey(payload.definition.id, date, slot.id)
  return {
    key,
    routineId: payload.definition.id,
    slotId: slot.id,
    scheduledDate: date,
    scheduledMinutes: slot.reminderMinutes,
    timeZoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    status,
    loggedAt: status === 'COMPLETED' ? now : '',
    modifiedAt: now,
    modifiedBy: id,
    note,
  }
}

export function scheduleSummary(definition: RoutineDefinition): string {
  if (definition.schedule.type === 'after_completion') {
    const days = definition.schedule.intervalDays
    return `${days} day${days === 1 ? '' : 's'} after completion`
  }
  const { weekdays, weekInterval } = definition.schedule
  if (weekdays.length === 0 && weekInterval === 1) return 'Every day'
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const days = weekdays.length === 0 ? 'every day' : weekdays.map((day) => names[day - 1]).join(', ')
  return weekInterval === 1 ? days : `${days}, every ${weekInterval} weeks`
}
