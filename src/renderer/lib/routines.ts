export const ROUTINE_MARKER_PREFIX = '<!-- vicu-routine:'
export const NULL_DATE = '0001-01-01T00:00:00Z'

const CURRENT_VERSION = 1
const MARKER_RE = /<!--\s*vicu-routine:v(\d+):([A-Za-z0-9_-]+={0,2})\s*-->/
const ANY_MARKER_RE = /<!--\s*vicu-routine:[\s\S]*?-->/

export type RoutineKind = 'HEALTH' | 'CHORE'
export type HealthSubtype = 'SUPPLEMENT' | 'MEDICATION'
export type RoutinePeriod = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'ANYTIME' | 'HOME'
export type OccurrenceStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'NOT_LOGGED'

export type RoutineSchedule =
  | { type: 'calendar'; weekdays: number[]; weekInterval: number; anchorDate: string }
  | { type: 'after_completion'; intervalDays: number; firstDueDate: string }

export interface RoutineSlot {
  id: string
  label: string
  period: RoutinePeriod
  reminderMinutes: number
  reminderEnabled: boolean
  followUpMinutes: number
}

export interface RoutineDefinition {
  id: string
  name: string
  kind: RoutineKind
  healthSubtype: HealthSubtype | null
  amount: string
  unit: string
  iconName: string
  color: string
  schedule: RoutineSchedule
  slots: RoutineSlot[]
  activeFrom: string
  archived: boolean
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export interface RoutineOccurrenceRecord {
  key: string
  routineId: string
  slotId: string
  scheduledDate: string
  scheduledMinutes: number
  timeZoneId: string
  status: OccurrenceStatus
  loggedAt: string
  modifiedAt: string
  modifiedBy: string
  note: string
}

export interface RoutinePayload {
  version: number
  definition: RoutineDefinition
  occurrences: Record<string, RoutineOccurrenceRecord>
  prunedBefore: string
}

export interface ParsedRoutineEnvelope {
  isCarrier: boolean
  body: string
  payload?: RoutinePayload
  error?: string
}

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

export function hasRoutineMarker(description?: string | null): boolean {
  return !!description && ANY_MARKER_RE.test(description)
}

export function parseRoutineEnvelope(description?: string | null): ParsedRoutineEnvelope {
  if (!description) return { isCarrier: false, body: '' }
  const any = description.match(ANY_MARKER_RE)
  if (!any || any.index === undefined) return { isCarrier: false, body: description }
  const body = `${description.slice(0, any.index)}${description.slice(any.index + any[0].length)}`.trimEnd()
  const marker = any[0].match(MARKER_RE)
  if (!marker) return { isCarrier: true, body, error: 'Malformed routine metadata' }
  if (Number(marker[1]) !== CURRENT_VERSION) {
    return { isCarrier: true, body, error: `Routine metadata version ${marker[1]} is not supported` }
  }
  try {
    const encoded = marker[2].replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    if (bytes.byteLength > 512 * 1024) throw new Error('Routine metadata is too large')
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as RoutinePayload
    validatePayload(payload)
    return { isCarrier: true, body, payload }
  } catch (error) {
    return {
      isCarrier: true,
      body,
      error: error instanceof Error ? error.message : 'Cannot decode routine metadata',
    }
  }
}

export function encodeRoutineEnvelope(payload: RoutinePayload): string {
  validatePayload(payload)
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (bytes.byteLength > 512 * 1024) throw new Error('Routine metadata is too large')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `<!-- vicu-routine:v${CURRENT_VERSION}:${encoded} -->`
}

export function upsertRoutineEnvelope(body: string, payload: RoutinePayload): string {
  const clean = body.replace(ANY_MARKER_RE, '').trimEnd()
  const marker = encodeRoutineEnvelope(payload)
  return clean ? `${clean}\n${marker}` : marker
}

function validatePayload(payload: RoutinePayload): void {
  if (!payload || payload.version !== CURRENT_VERSION) throw new Error('Routine payload version mismatch')
  const definition = payload.definition
  if (!definition?.id || !definition.name?.trim()) throw new Error('Routine identity is missing')
  if (!Array.isArray(definition.slots) || definition.slots.length === 0) throw new Error('Routine has no slots')
  if (new Set(definition.slots.map((slot) => slot.id)).size !== definition.slots.length) {
    throw new Error('Routine slot ids must be unique')
  }
  parseLocalDate(definition.activeFrom)
  if (definition.schedule.type === 'calendar') parseLocalDate(definition.schedule.anchorDate)
  else {
    if (definition.schedule.intervalDays < 1) throw new Error('Routine interval must be positive')
    parseLocalDate(definition.schedule.firstDueDate)
  }
  if (!payload.occurrences || typeof payload.occurrences !== 'object') payload.occurrences = {}
}

export function routineOccurrenceKey(routineId: string, date: string, slotId: string): string {
  return `${routineId}:${date}:${slotId}`
}

export function localDateString(value = new Date()): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid local date: ${value}`)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (localDateString(date) !== value) throw new Error(`Invalid local date: ${value}`)
  return date
}

export function addLocalDays(value: string, days: number): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return localDateString(date)
}

export function isoWeekday(value: string): number {
  return parseLocalDate(value).getDay() || 7
}

function dayDifference(from: string, to: string): number {
  const start = parseLocalDate(from)
  const end = parseLocalDate(to)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function isoWeekStart(value: string): string {
  return addLocalDays(value, 1 - isoWeekday(value))
}

export function isCalendarScheduled(schedule: Extract<RoutineSchedule, { type: 'calendar' }>, date: string): boolean {
  if (date < schedule.anchorDate) return false
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(isoWeekday(date))) return false
  const weeks = Math.floor(dayDifference(isoWeekStart(schedule.anchorDate), isoWeekStart(date)) / 7)
  return weeks % Math.max(1, schedule.weekInterval) === 0
}

export function latestCompletionDate(payload: RoutinePayload): string | undefined {
  return Object.values(payload.occurrences)
    .filter((record) => record.status === 'COMPLETED' && /^\d{4}-\d{2}-\d{2}$/.test(record.scheduledDate))
    .map((record) => record.scheduledDate)
    .sort()
    .at(-1)
}

export function routineDueDate(payload: RoutinePayload): string | undefined {
  const schedule = payload.definition.schedule
  if (schedule.type !== 'after_completion') return undefined
  const latest = latestCompletionDate(payload)
  return latest ? addLocalDays(latest, Math.max(1, schedule.intervalDays)) : schedule.firstDueDate
}

export function occurrencesForDate<TTask>(
  carrier: RoutineCarrier<TTask>,
  date: string,
  today = localDateString(),
): RoutineOccurrence<TTask>[] {
  const { definition } = carrier.payload
  if (definition.archived || date < definition.activeFrom) return []
  let effectiveDate = date
  if (definition.schedule.type === 'calendar') {
    if (!isCalendarScheduled(definition.schedule, date)) return []
  } else {
    const due = routineDueDate(carrier.payload)!
    if (date !== due && !(date === today && due < today)) return []
    effectiveDate = due
  }

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

function atLeastAsRecent(leftTime: string, leftDevice: string, rightTime: string, rightDevice: string): boolean {
  return leftTime > rightTime || (leftTime === rightTime && leftDevice >= rightDevice)
}

export function mergeRoutinePayload(local: RoutinePayload, remote: RoutinePayload): RoutinePayload {
  const definition = atLeastAsRecent(
    local.definition.updatedAt,
    local.definition.updatedBy,
    remote.definition.updatedAt,
    remote.definition.updatedBy,
  ) ? local.definition : remote.definition
  const occurrences: Record<string, RoutineOccurrenceRecord> = {}
  for (const key of new Set([...Object.keys(remote.occurrences), ...Object.keys(local.occurrences)])) {
    const left = local.occurrences[key]
    const right = remote.occurrences[key]
    occurrences[key] = !left ? right : !right ? left : atLeastAsRecent(
      left.modifiedAt,
      left.modifiedBy,
      right.modifiedAt,
      right.modifiedBy,
    ) ? left : right
  }
  return {
    version: Math.max(local.version, remote.version),
    definition,
    occurrences,
    prunedBefore: local.prunedBefore > remote.prunedBefore ? local.prunedBefore : remote.prunedBefore,
  }
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

export function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60).toString().padStart(2, '0')
  const minute = (minutes % 60).toString().padStart(2, '0')
  return `${hour}:${minute}`
}

export function statusRecord(
  payload: RoutinePayload,
  date: string,
  slot: RoutineSlot,
  status: OccurrenceStatus,
  note = '',
): RoutineOccurrenceRecord {
  const now = new Date().toISOString()
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

export function csvForRoutines<TTask>(carriers: RoutineCarrier<TTask>[]): string {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
  const rows = carriers.flatMap(({ payload }) => Object.values(payload.occurrences).map((occurrence) => [
    payload.definition.name,
    occurrence.scheduledDate,
    timeLabel(occurrence.scheduledMinutes),
    occurrence.status,
    occurrence.loggedAt,
    occurrence.timeZoneId,
    occurrence.note,
  ].map(escape).join(',')))
  return ['routine,scheduled_date,scheduled_time,status,logged_at,time_zone,note', ...rows.sort()].join('\n')
}
