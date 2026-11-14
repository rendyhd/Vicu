/**
 * Routine rules shared by the main process (reminders) and the renderer. Implements section 6 of
 * docs/cross-app-semantics-v1.md; Android implements the same contract and both apps run
 * test-fixtures/routine-archive-v1.json against it.
 *
 * - A routine lives in a hidden done task (the "main carrier") whose description holds
 *   `<!-- vicu-routine:v1:<base64url JSON> -->`. Older history lives in done "archive part" tasks
 *   holding `<!-- vicu-routine:archive:v1:<base64url JSON> -->` (section 6.4).
 * - Calendar dates are local `YYYY-MM-DD` strings; day arithmetic goes through due-dates.ts.
 * - Timestamps are compared as parsed instants, never as strings, and written as UTC ISO-8601
 *   with exactly three fraction digits (`Date#toISOString`).
 * - Everything here is pure: no I/O, no storage, no time zone surprises beyond "the device zone"
 *   where the contract says so.
 *
 * This file only imports its sibling due-date helpers, so any tsconfig can include it.
 */

import { addLocalDays, diffLocalDays, isoWeekday, startOfWeek, toLocalDate } from './due-dates'

// --- Constants ---------------------------------------------------------------------------

/** Title of every archive part task. */
export const ROUTINE_ARCHIVE_TITLE = 'Vicu routine archive'
/** Search text that finds archive parts server side (the marker name inside the HTML comment). */
export const ROUTINE_ARCHIVE_SEARCH = 'vicu-routine:archive'
/**
 * Search text that finds main carriers server side without the archive parts: `vicu-routine:v1:...`
 * matches, `vicu-routine:archive:v1:...` does not.
 */
export const ROUTINE_CARRIER_SEARCH = 'vicu-routine:v'
/** A main carrier or archive part is written at or below this many bytes of JSON (384 KiB). */
export const ROUTINE_BUDGET_BYTES = 384 * 1024
/** Anything above this is rejected (512 KiB), so older clients can still read what we write. */
export const ROUTINE_HARD_LIMIT_BYTES = 512 * 1024
/** The main carrier keeps occurrences from the last 400 days. */
export const ROUTINE_WINDOW_DAYS = 400
/** The cutoff moves forward by this many days while the payload is over budget. */
export const ROUTINE_PRUNE_STEP_DAYS = 30

const CURRENT_VERSION = 1

/** A local calendar date, `YYYY-MM-DD`. */
type LocalDate = string

// --- Types -------------------------------------------------------------------------------

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
  /**
   * Shared through the routine's project (section 6.9). Missing or false: private. Only the owner,
   * the user who created the main carrier, changes it.
   */
  shared?: boolean
}

/**
 * Who logged an occurrence of a shared routine (section 6.9). The device is the record's
 * `modifiedBy` when it was written; a person is named only while the two still match.
 */
export interface RoutineLoggedBy {
  userId: number
  deviceId: string
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
  /** Set on a person's change to an occurrence of a shared routine (section 6.9). */
  loggedBy?: RoutineLoggedBy
}

export interface RoutinePayload {
  version: number
  definition: RoutineDefinition
  occurrences: Record<string, RoutineOccurrenceRecord>
  prunedBefore: string
}

/** One archive part: older occurrences of one routine (section 6.4). */
export interface RoutineArchivePart {
  version: number
  routineId: string
  part: number
  occurrences: Record<string, RoutineOccurrenceRecord>
}

export interface ParsedRoutineEnvelope {
  isCarrier: boolean
  body: string
  payload?: RoutinePayload
  error?: string
  /**
   * A newer version of Vicu wrote it (marker or payload version above the one this app knows): it
   * is shown as "update required" and never written or deleted (cross-app semantics 10.7).
   */
  updateRequired?: boolean
}

export interface ParsedArchiveEnvelope {
  isArchive: boolean
  part?: RoutineArchivePart
  error?: string
  /** Written by a newer version of Vicu; never written over. */
  updateRequired?: boolean
}

// --- Markers -----------------------------------------------------------------------------

// Whitespace inside the comment is only space, tab, CR and LF, as in the hiding rule
// (docs/cross-app-semantics-v1.md section 10.1, shared/hidden-tasks.ts).
const MARKER_RE = /<!--[ \t\r\n]*vicu-routine:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/
/** Any main-carrier marker; the lookahead keeps archive markers out. */
const ANY_MARKER_RE = /<!--[ \t\r\n]*vicu-routine:(?!archive:)[\s\S]*?-->/
/** The start of a main-carrier marker, closed or not. */
const MARKER_START_RE = /<!--[ \t\r\n]*vicu-routine:(?!archive:)/
const ARCHIVE_MARKER_RE = /<!--[ \t\r\n]*vicu-routine:archive:v(\d+):([A-Za-z0-9_-]+={0,2})[ \t\r\n]*-->/
const ANY_ARCHIVE_MARKER_RE = /<!--[ \t\r\n]*vicu-routine:archive:[\s\S]*?-->/
/** The start of an archive-part marker, closed or not. */
const ARCHIVE_MARKER_START_RE = /<!--[ \t\r\n]*vicu-routine:archive:/

/** True when the description holds a main routine carrier marker (not an archive part). */
export function hasRoutineMarker(description?: string | null): boolean {
  return !!description && MARKER_START_RE.test(description)
}

/** True when the description holds a routine archive part marker. */
export function hasRoutineArchiveMarker(description?: string | null): boolean {
  return !!description && ARCHIVE_MARKER_START_RE.test(description)
}

// --- Encoding ----------------------------------------------------------------------------

/** UTF-8 byte length of a string. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(encoded: string): unknown {
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = standard + '='.repeat((4 - standard.length % 4) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (bytes.byteLength > ROUTINE_HARD_LIMIT_BYTES) throw new Error('Routine metadata is too large')
  return JSON.parse(new TextDecoder().decode(bytes))
}

function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    return addLocalDays(value, 0) === value
  } catch {
    return false
  }
}

function assertLocalDate(value: unknown): void {
  if (!isLocalDate(value)) throw new Error(`Invalid local date: ${String(value)}`)
}

function validatePayload(payload: RoutinePayload): void {
  if (!payload || payload.version !== CURRENT_VERSION) throw new Error('Routine payload version mismatch')
  const definition = payload.definition
  if (!definition?.id || !definition.name?.trim()) throw new Error('Routine identity is missing')
  if (!Array.isArray(definition.slots) || definition.slots.length === 0) throw new Error('Routine has no slots')
  if (new Set(definition.slots.map((slot) => slot.id)).size !== definition.slots.length) {
    throw new Error('Routine slot ids must be unique')
  }
  assertLocalDate(definition.activeFrom)
  if (definition.schedule.type === 'calendar') assertLocalDate(definition.schedule.anchorDate)
  else {
    if (definition.schedule.intervalDays < 1) throw new Error('Routine interval must be positive')
    assertLocalDate(definition.schedule.firstDueDate)
  }
  if (!payload.occurrences || typeof payload.occurrences !== 'object') payload.occurrences = {}
  if (typeof payload.prunedBefore !== 'string') payload.prunedBefore = ''
}

function validateArchivePart(part: RoutineArchivePart): void {
  if (!part || part.version !== CURRENT_VERSION) throw new Error('Routine archive version mismatch')
  if (!part.routineId) throw new Error('Routine archive has no routine id')
  if (!Number.isInteger(part.part) || part.part < 1) throw new Error('Routine archive part number is invalid')
  if (!part.occurrences || typeof part.occurrences !== 'object') part.occurrences = {}
  for (const [key, record] of Object.entries(part.occurrences)) {
    if (!record || typeof record.scheduledDate !== 'string') throw new Error('Routine archive record is malformed')
    if (!record.key) record.key = key
  }
}

/** Decoded JSON size of a main carrier payload. */
export function routineJsonBytes(payload: RoutinePayload): number {
  return utf8Bytes(JSON.stringify(payload))
}

/** True when decoded JSON says it was written by a newer version than this app knows. */
function isNewerPayload(value: unknown): boolean {
  const version = (value as { version?: unknown } | null)?.version
  return typeof value === 'object' && value !== null && typeof version === 'number' && version > CURRENT_VERSION
}

export function parseRoutineEnvelope(description?: string | null): ParsedRoutineEnvelope {
  if (!description) return { isCarrier: false, body: '' }
  const any = description.match(ANY_MARKER_RE)
  if (!any || any.index === undefined) {
    // An unclosed marker still makes it a carrier, an unreadable one.
    return MARKER_START_RE.test(description)
      ? { isCarrier: true, body: description, error: 'Malformed routine metadata' }
      : { isCarrier: false, body: description }
  }
  const body = `${description.slice(0, any.index)}${description.slice(any.index + any[0].length)}`.trimEnd()
  const marker = any[0].match(MARKER_RE)
  if (!marker) return { isCarrier: true, body, error: 'Malformed routine metadata' }
  if (Number(marker[1]) !== CURRENT_VERSION) {
    return {
      isCarrier: true,
      body,
      error: `Routine metadata version ${marker[1]} is not supported`,
      ...(Number(marker[1]) > CURRENT_VERSION ? { updateRequired: true } : {}),
    }
  }
  try {
    const payload = decodeBase64Url(marker[2]) as RoutinePayload
    if (isNewerPayload(payload)) {
      return { isCarrier: true, body, error: `Routine payload version ${payload.version} is not supported`, updateRequired: true }
    }
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
  const json = JSON.stringify(payload)
  if (utf8Bytes(json) > ROUTINE_HARD_LIMIT_BYTES) throw new Error('Routine metadata is too large')
  return `<!-- vicu-routine:v${CURRENT_VERSION}:${encodeBase64Url(json)} -->`
}

export function upsertRoutineEnvelope(body: string, payload: RoutinePayload): string {
  const clean = body.replace(ANY_MARKER_RE, '').trimEnd()
  const marker = encodeRoutineEnvelope(payload)
  return clean ? `${clean}\n${marker}` : marker
}

/** Reads an archive part task description. A non-archive description is `isArchive: false`. */
export function parseRoutineArchiveEnvelope(description?: string | null): ParsedArchiveEnvelope {
  if (!description) return { isArchive: false }
  const any = description.match(ANY_ARCHIVE_MARKER_RE)
  if (!any) {
    return ARCHIVE_MARKER_START_RE.test(description)
      ? { isArchive: true, error: 'Malformed routine archive metadata' }
      : { isArchive: false }
  }
  const marker = any[0].match(ARCHIVE_MARKER_RE)
  if (!marker) return { isArchive: true, error: 'Malformed routine archive metadata' }
  if (Number(marker[1]) !== CURRENT_VERSION) {
    return {
      isArchive: true,
      error: `Routine archive version ${marker[1]} is not supported`,
      ...(Number(marker[1]) > CURRENT_VERSION ? { updateRequired: true } : {}),
    }
  }
  try {
    const part = decodeBase64Url(marker[2]) as RoutineArchivePart
    if (isNewerPayload(part)) {
      return { isArchive: true, error: `Routine archive version ${part.version} is not supported`, updateRequired: true }
    }
    validateArchivePart(part)
    return { isArchive: true, part }
  } catch (error) {
    return {
      isArchive: true,
      error: error instanceof Error ? error.message : 'Cannot decode routine archive metadata',
    }
  }
}

/** The description of an archive part task: only the marker (section 6.4). */
export function encodeRoutineArchiveEnvelope(part: RoutineArchivePart): string {
  validateArchivePart(part)
  const json = JSON.stringify(part)
  if (utf8Bytes(json) > ROUTINE_HARD_LIMIT_BYTES) throw new Error('Routine archive part is too large')
  return `<!-- vicu-routine:archive:v${CURRENT_VERSION}:${encodeBase64Url(json)} -->`
}

// --- Keys, dates, timestamps -------------------------------------------------------------

export function routineOccurrenceKey(routineId: string, date: string, slotId: string): string {
  return `${routineId}:${date}:${slotId}`
}

/** A timestamp as UTC ISO-8601 with exactly three fraction digits. */
export function formatInstant(value: Date | number = new Date()): string {
  return new Date(value).toISOString()
}

/** Milliseconds of a timestamp; one that does not parse sorts before every real instant. */
function instantOf(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

/**
 * Last-write-wins order: the later instant, then the larger device id. Positive when the left
 * side is newer, negative when the right side is, 0 when both are the same.
 */
function compareWrites(leftTime: string, leftDevice: string, rightTime: string, rightDevice: string): number {
  const left = instantOf(leftTime)
  const right = instantOf(rightTime)
  if (left !== right) return left > right ? 1 : -1
  if (leftDevice === rightDevice) return 0
  return leftDevice > rightDevice ? 1 : -1
}

/** The later of two local dates; an empty string is "none". */
function laterDate(left: string, right: string): string {
  return left >= right ? left : right
}

// --- Calendar and after-completion schedules (section 6.5) -------------------------------

export function isCalendarScheduled(schedule: Extract<RoutineSchedule, { type: 'calendar' }>, date: string): boolean {
  if (date < schedule.anchorDate) return false
  if (schedule.weekdays.length > 0 && !schedule.weekdays.includes(isoWeekday(date))) return false
  const weeks = Math.floor(diffLocalDays(startOfWeek(schedule.anchorDate, 'monday'), startOfWeek(date, 'monday')) / 7)
  return weeks % Math.max(1, schedule.weekInterval) === 0
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>()

function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
  if (zoneFormatters.has(zone)) return zoneFormatters.get(zone) ?? null
  let formatter: Intl.DateTimeFormat | null = null
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    formatter = null
  }
  zoneFormatters.set(zone, formatter)
  return formatter
}

/**
 * The calendar date of an instant in a time zone (IANA id). A missing or unknown zone means the
 * device zone.
 */
export function localDateInZone(ms: number, zone?: string): LocalDate {
  const formatter = zone ? zoneFormatter(zone) : null
  if (formatter) {
    const parts = formatter.formatToParts(new Date(ms))
    const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? ''
    const year = part('year').padStart(4, '0')
    return `${year}-${part('month')}-${part('day')}`
  }
  return toLocalDate(new Date(ms))
}

/**
 * The completion date of a `COMPLETED` occurrence: the local date of `loggedAt` in the
 * occurrence's time zone, or its `scheduledDate` when there is no usable `loggedAt`.
 */
export function completionDate(record: Pick<RoutineOccurrenceRecord, 'loggedAt' | 'timeZoneId' | 'scheduledDate'>): LocalDate | undefined {
  const logged = record.loggedAt ? Date.parse(record.loggedAt) : Number.NaN
  if (!Number.isNaN(logged)) return localDateInZone(logged, record.timeZoneId)
  return isLocalDate(record.scheduledDate) ? record.scheduledDate : undefined
}

/** The record whose completion date is the latest among `COMPLETED` occurrences, with that date. */
function latestCompletion(payload: RoutinePayload): { record: RoutineOccurrenceRecord; date: LocalDate } | undefined {
  let best: { record: RoutineOccurrenceRecord; date: LocalDate } | undefined
  for (const record of Object.values(payload.occurrences)) {
    if (record.status !== 'COMPLETED') continue
    const date = completionDate(record)
    if (date && (!best || date > best.date)) best = { record, date }
  }
  return best
}

/** The largest completion date over all `COMPLETED` occurrences of the main carrier. */
export function latestCompletionDate(payload: RoutinePayload): LocalDate | undefined {
  return latestCompletion(payload)?.date
}

/** Next due date of an `after_completion` routine; undefined for a calendar routine. */
export function routineDueDate(payload: RoutinePayload): LocalDate | undefined {
  const schedule = payload.definition.schedule
  if (schedule.type !== 'after_completion') return undefined
  const latest = latestCompletionDate(payload)
  return latest ? addLocalDays(latest, Math.max(1, schedule.intervalDays)) : schedule.firstDueDate
}

/**
 * The scheduled date an occurrence on calendar day `date` carries, or null when the routine is
 * not scheduled that day (also null for an archived routine or before `activeFrom`).
 *
 * An `after_completion` routine is scheduled on its due date. When `today` is given, an overdue
 * one is also shown on `today` (with its due date); reminders pass no `today` and only fire on
 * the due date itself.
 */
export function scheduledDateOn(
  payload: RoutinePayload,
  date: LocalDate,
  options: { today?: LocalDate } = {},
): LocalDate | null {
  const { definition } = payload
  if (definition.archived || date < definition.activeFrom) return null
  if (definition.schedule.type === 'calendar') return isCalendarScheduled(definition.schedule, date) ? date : null
  const due = routineDueDate(payload)!
  if (date === due) return due
  if (options.today !== undefined && date === options.today && due < options.today) return due
  return null
}

// --- Merge (section 6.3) -----------------------------------------------------------------

/** The newer of two records for the same key; on an exact tie the left one stays. */
export function newerOccurrence(left: RoutineOccurrenceRecord, right: RoutineOccurrenceRecord): RoutineOccurrenceRecord {
  return compareWrites(left.modifiedAt, left.modifiedBy, right.modifiedAt, right.modifiedBy) >= 0 ? left : right
}

/** Union of keys, last-write-wins per key. The first argument wins exact ties. */
export function mergeOccurrenceMaps(
  ...maps: Array<Record<string, RoutineOccurrenceRecord>>
): Record<string, RoutineOccurrenceRecord> {
  const merged: Record<string, RoutineOccurrenceRecord> = {}
  for (const map of maps) {
    for (const [key, record] of Object.entries(map)) {
      const existing = merged[key]
      merged[key] = existing ? newerOccurrence(existing, record) : record
    }
  }
  return merged
}

/** Drops every occurrence scheduled before `prunedBefore` (they live in the archive). */
export function dropPrunedOccurrences(
  occurrences: Record<string, RoutineOccurrenceRecord>,
  prunedBefore: string,
): Record<string, RoutineOccurrenceRecord> {
  if (!prunedBefore) return occurrences
  const kept: Record<string, RoutineOccurrenceRecord> = {}
  for (const [key, record] of Object.entries(occurrences)) {
    if (record.scheduledDate >= prunedBefore) kept[key] = record
  }
  return kept
}

/**
 * Merges the local payload with the server's (`remote`, contract 6.3). Fields this app does not
 * know are kept at every level (contract 10.8): the winning definition and each winning occurrence
 * carry their own, and the unknown top-level fields are the union of both sides, the server's value
 * kept for a field on both.
 */
export function mergeRoutinePayload(local: RoutinePayload, remote: RoutinePayload): RoutinePayload {
  const definition = compareWrites(
    local.definition.updatedAt,
    local.definition.updatedBy,
    remote.definition.updatedAt,
    remote.definition.updatedBy,
  ) >= 0 ? local.definition : remote.definition
  const prunedBefore = laterDate(local.prunedBefore ?? '', remote.prunedBefore ?? '')
  return {
    ...local,
    ...remote,
    version: Math.max(local.version, remote.version),
    definition,
    occurrences: dropPrunedOccurrences(mergeOccurrenceMaps(local.occurrences, remote.occurrences), prunedBefore),
    prunedBefore,
  }
}

// --- Writing a carrier (section 6.8) -----------------------------------------------------

/**
 * "Same state, first record kept" (section 6.8): where `merged` would replace the server's record of
 * an occurrence with one of the same status and note, the server's record is kept, so a screen or
 * notification that was out of date does not take the occurrence over from whoever logged it first.
 * The merge itself (section 6.3) is unchanged; this runs only on what a write sends.
 */
export function keepServerRecordsOfSameState(merged: RoutinePayload, remote: RoutinePayload): RoutinePayload {
  let occurrences: Record<string, RoutineOccurrenceRecord> | null = null
  for (const [key, record] of Object.entries(merged.occurrences)) {
    const server = remote.occurrences[key]
    if (!server || server === record) continue
    if (server.modifiedAt === record.modifiedAt && server.modifiedBy === record.modifiedBy) continue
    if (server.status !== record.status || (server.note ?? '') !== (record.note ?? '')) continue
    occurrences ??= { ...merged.occurrences }
    occurrences[key] = server
  }
  return occurrences ? { ...merged, occurrences } : merged
}

/** How many times a carrier write is sent before it is reported as failed (section 6.8). */
export const ROUTINE_WRITE_ATTEMPTS = 4

/**
 * How long a write that went through waits before it reads the carrier back (section 6.8): long
 * enough for a write that passed Vikunja's test at the same moment to have been stored.
 */
export const ROUTINE_VERIFY_DELAY_MS = 500

/** The wait before another try after a 5xx (an SQLite server that was busy), times the try. */
export const ROUTINE_SERVER_ERROR_DELAY_MS = 250

/** How far back a refresh looks for this device's changes the server lost (section 6.8). */
export const ROUTINE_REASSERT_DAYS = 7

/**
 * True when the server's copy `remote` holds everything in `wanted`: merging it in (section 6.3,
 * with "same state, first record kept") changes nothing. A write that went through and still
 * fails this lost part of what it sent to a write made at the same moment (section 6.8).
 */
export function routineWriteHeld(remote: RoutinePayload, wanted: RoutinePayload): boolean {
  const merged = keepServerRecordsOfSameState(mergeRoutinePayload(wanted, remote), remote)
  return sortedJson(merged) === sortedJson(mergeRoutinePayload(remote, remote))
}

/** True when the records `stored` hold every record of `wanted`, or a newer one (section 6.3). */
export function occurrencesHeld(
  stored: Record<string, RoutineOccurrenceRecord>,
  wanted: Record<string, RoutineOccurrenceRecord>,
): boolean {
  return Object.entries(wanted).every(([key, record]) => {
    const kept = stored[key]
    return kept !== undefined && sortedJson(newerOccurrence(kept, record)) === sortedJson(kept)
  })
}

/** JSON with object keys sorted at every level, so two payloads compare by content only. */
function sortedJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort)
    if (!entry || typeof entry !== 'object') return entry
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(entry as Record<string, unknown>).sort()) {
      const field = (entry as Record<string, unknown>)[key]
      if (field !== undefined) sorted[key] = sort(field)
    }
    return sorted
  }
  return JSON.stringify(sort(value))
}

/**
 * This device's changes that the server's copy lost (section 6.8): the records of `local` that
 * `deviceId` wrote since `since`, and the definition when it wrote that since then, as a payload to
 * write again, or null when `server` already holds all of it. `local` is the copy the device last
 * wrote or read; anything else in it is left out, so an old copy never brings back what another
 * device archived.
 */
export function lostOwnRoutineChanges(
  local: RoutinePayload,
  server: RoutinePayload,
  deviceId: string,
  since: Date,
): RoutinePayload | null {
  if (local.definition.id !== server.definition.id) return null
  const recent = (at: string) => {
    const time = Date.parse(at)
    return Number.isFinite(time) && time >= since.getTime()
  }
  const own = Object.fromEntries(
    Object.entries(local.occurrences).filter(([, record]) => record.modifiedBy === deviceId && recent(record.modifiedAt)),
  )
  const ownDefinition = local.definition.updatedBy === deviceId && recent(local.definition.updatedAt)
  if (Object.keys(own).length === 0 && !ownDefinition) return null
  const probe: RoutinePayload = { ...server, definition: ownDefinition ? local.definition : server.definition, occurrences: own }
  return routineWriteHeld(server, probe) ? null : probe
}

/** One operation of a JSON Patch (RFC 6902) as Vikunja takes it on `PATCH tasks/{id}`. */
export type JsonPatchOperation =
  | { op: 'test' | 'replace' | 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }

const NULL_DUE_DATE = '0001-01-01T00:00:00Z'

/**
 * The JSON Patch of a carrier write (section 6.8): a test that the description is still the one
 * read, then the title, the description and the forced fields of section 10.2, and the project when
 * the routine moves (section 6.9).
 */
export function carrierWriteOperations(
  readDescription: string,
  title: string,
  description: string,
  options: { projectId?: number } = {},
): JsonPatchOperation[] {
  const ops: JsonPatchOperation[] = [
    { op: 'test', path: '/description', value: readDescription },
    { op: 'replace', path: '/title', value: title },
    { op: 'replace', path: '/description', value: description },
    { op: 'replace', path: '/done', value: true },
    { op: 'replace', path: '/due_date', value: NULL_DUE_DATE },
    { op: 'replace', path: '/repeat_after', value: 0 },
    { op: 'replace', path: '/repeat_mode', value: 0 },
    { op: 'replace', path: '/reminders', value: [] },
  ]
  if (options.projectId !== undefined) ops.push({ op: 'replace', path: '/project_id', value: options.projectId })
  return ops
}

/** The JSON Patch of an archive part write: the test, then the description only (section 6.8). */
export function archiveWriteOperations(readDescription: string, description: string): JsonPatchOperation[] {
  return [
    { op: 'test', path: '/description', value: readDescription },
    { op: 'replace', path: '/description', value: description },
  ]
}

// --- Shared routines (section 6.9) -------------------------------------------------------

/** True when the routine's owner shared it (`definition.shared`). */
export function isSharedRoutine(payload: Pick<RoutinePayload, 'definition'>): boolean {
  return payload.definition.shared === true
}

/**
 * Whether an app signed in as `me` reads a main carrier (sections 6.9 and 10.3): its own, or another
 * user's that is shared. Until the user is known nothing is read.
 */
export function routineCarrierReadable(createdBy: number | null, shared: boolean, me: number | null | undefined): boolean {
  if (typeof me !== 'number' || me <= 0) return false
  return createdBy === me || shared
}

/**
 * The carriers to show when several carry the same routine id (review S-5): a member of a shared
 * project can make a carrier with someone else's routine id and `shared: true`, and a tick on it
 * would go into their task. So where the user has a carrier of that id, every other user's carrier
 * of it is left out; where only other users have one, the oldest task (lowest id) stays, as a copy
 * made later cannot be older than the routine. The user's own carriers are all kept, as before.
 * The order of `carriers` is kept.
 */
export function preferOwnRoutineCarriers<T extends { task: { id: number; created_by?: { id?: unknown } | null }; payload: Pick<RoutinePayload, 'definition'> }>(
  carriers: readonly T[],
  me: number | null | undefined,
): T[] {
  const isOwn = (carrier: T) => typeof me === 'number' && me > 0 && carrier.task.created_by?.id === me
  const ownIds = new Set(carriers.filter(isOwn).map((carrier) => carrier.payload.definition.id))
  const oldestOther = new Map<string, number>()
  for (const carrier of carriers) {
    if (isOwn(carrier)) continue
    const id = carrier.payload.definition.id
    const kept = oldestOther.get(id)
    if (kept === undefined || carrier.task.id < kept) oldestOther.set(id, carrier.task.id)
  }
  return carriers.filter((carrier) => {
    if (isOwn(carrier)) return true
    const id = carrier.payload.definition.id
    return !ownIds.has(id) && oldestOther.get(id) === carrier.task.id
  })
}

/**
 * Whether an archive part counts (section 6.9): its routine is one the app reads (`routines`, by
 * id), whoever created the part. A part a member wrote while the routine was shared stays part of
 * its history when the owner stops sharing it. Until the user is known nothing is read.
 */
export function archivePartReadable(
  routineId: string,
  me: number | null | undefined,
  routines: ReadonlyMap<string, { shared: boolean }>,
): boolean {
  if (typeof me !== 'number' || me <= 0) return false
  return routines.has(routineId)
}

/**
 * The person who logged a record (section 6.9): `loggedBy.userId` while `loggedBy.deviceId` is the
 * record's `modifiedBy`, else nobody (a version without `loggedBy` logged it again since).
 */
export function loggedByUserId(record: Pick<RoutineOccurrenceRecord, 'modifiedBy' | 'loggedBy'> | undefined): number | null {
  const loggedBy = record?.loggedBy
  if (!loggedBy || typeof loggedBy !== 'object') return null
  if (typeof loggedBy.userId !== 'number' || !Number.isInteger(loggedBy.userId) || loggedBy.userId <= 0) return null
  return loggedBy.deviceId === record?.modifiedBy ? loggedBy.userId : null
}

// --- Pruning (section 6.2) ---------------------------------------------------------------

export interface PruneOutcome {
  /** The payload without the pruned occurrences and with the advanced `prunedBefore`. */
  payload: RoutinePayload
  /** The occurrences that left the payload and belong in the archive. */
  archived: RoutineOccurrenceRecord[]
}

/**
 * The newest `prunedBefore` that may not be passed: the occurrence an `after_completion` routine
 * counts from (and the one it will log next) has to stay in the main carrier, otherwise the
 * next due date would fall back to an older completion or to `firstDueDate`. A calendar routine
 * has no such limit.
 */
function pruneCeiling(payload: RoutinePayload): LocalDate | undefined {
  const schedule = payload.definition.schedule
  if (schedule.type !== 'after_completion') return undefined
  const latest = latestCompletion(payload)
  return latest && isLocalDate(latest.record.scheduledDate) ? latest.record.scheduledDate : schedule.firstDueDate
}

/**
 * Moves history older than the rolling window out of a payload (section 6.2): cutoff = today - 400
 * days, never earlier than the existing `prunedBefore`; while the JSON is over `budgetBytes` the
 * cutoff moves forward in 30-day steps (never past today, so today's occurrences stay).
 * `prunedBefore` only advances when something moved.
 * The caller writes `archived` to the archive first and the returned payload afterwards.
 */
export function pruneRoutinePayload(
  payload: RoutinePayload,
  today: LocalDate,
  budgetBytes = ROUTINE_BUDGET_BYTES,
): PruneOutcome {
  const existing = payload.prunedBefore ?? ''
  // Today's occurrences always stay, however far the shrinking has to go.
  const scheduleCeiling = pruneCeiling(payload)
  const ceiling = scheduleCeiling !== undefined && scheduleCeiling < today ? scheduleCeiling : today
  const clamp = (cutoff: LocalDate): LocalDate => laterDate(cutoff > ceiling ? ceiling : cutoff, existing)
  const records = Object.entries(payload.occurrences)
  let effective = clamp(addLocalDays(today, -ROUTINE_WINDOW_DAYS))

  for (;;) {
    const kept: Record<string, RoutineOccurrenceRecord> = {}
    const archived: RoutineOccurrenceRecord[] = []
    for (const [key, record] of records) {
      if (record.scheduledDate < effective) archived.push(record)
      else kept[key] = record
    }
    const candidate: RoutinePayload = {
      ...payload,
      occurrences: kept,
      prunedBefore: archived.length > 0 ? effective : existing,
    }
    if (Object.keys(kept).length === 0 || routineJsonBytes(candidate) <= budgetBytes) {
      return { payload: candidate, archived }
    }
    const next = clamp(addLocalDays(effective, ROUTINE_PRUNE_STEP_DAYS))
    if (next === effective) return { payload: candidate, archived }
    effective = next
  }
}

// --- Archive parts (section 6.4) ---------------------------------------------------------

/** An archive part together with the id of the task that holds it. */
export interface ArchivePartRef {
  taskId: number
  part: RoutineArchivePart
}

export type ArchiveOp =
  | { kind: 'update'; taskId: number; part: RoutineArchivePart }
  | { kind: 'create'; part: RoutineArchivePart }

/** Sums entry sizes of an occurrence map so a part's JSON size is known without re-stringifying. */
class PartSizer {
  private readonly base: number
  private entries = 0
  private bytes = 0

  constructor(header: Omit<RoutineArchivePart, 'occurrences'>) {
    this.base = utf8Bytes(JSON.stringify({ ...header, occurrences: {} }))
  }

  static entryBytes(key: string, record: RoutineOccurrenceRecord): number {
    return utf8Bytes(JSON.stringify(key)) + 1 + utf8Bytes(JSON.stringify(record))
  }

  add(entry: number): void {
    this.bytes += entry
    this.entries += 1
  }

  /** Size of the JSON with `extra` more bytes of entries (and one more comma when needed). */
  sizeWith(extra: number): number {
    const count = this.entries + 1
    return this.base + this.bytes + extra + (count > 1 ? count - 1 : 0)
  }

  get size(): number {
    return this.base + this.bytes + (this.entries > 1 ? this.entries - 1 : 0)
  }
}

function sizerFor(part: RoutineArchivePart): PartSizer {
  const { occurrences, ...header } = part
  const sizer = new PartSizer(header)
  for (const [key, record] of Object.entries(occurrences)) sizer.add(PartSizer.entryBytes(key, record))
  return sizer
}

/**
 * Plans where `moved` occurrences go (section 6.4). A record whose key is already in a part is
 * merged there (last-write-wins); new keys are appended to the part with the highest number while
 * it stays within `budgetBytes`, and the rest go into new parts numbered after it.
 * Returns only the parts that change.
 */
export function planArchiveWrites(
  routineId: string,
  existing: ArchivePartRef[],
  moved: RoutineOccurrenceRecord[],
  budgetBytes = ROUTINE_BUDGET_BYTES,
): ArchiveOp[] {
  const mine = existing
    .filter((ref) => ref.part.routineId === routineId)
    .sort((left, right) => left.part.part - right.part.part || left.taskId - right.taskId)
    .map((ref) => ({
      taskId: ref.taskId,
      part: { ...ref.part, occurrences: { ...ref.part.occurrences } } as RoutineArchivePart,
      changed: false,
    }))
  const working = mine.map((entry) => ({ entry, sizer: sizerFor(entry.part) }))

  const ordered = [...moved].sort((left, right) =>
    left.scheduledDate < right.scheduledDate ? -1 : left.scheduledDate > right.scheduledDate ? 1 :
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  const appended: RoutineOccurrenceRecord[] = []

  for (const record of ordered) {
    const holder = working.find(({ entry }) => record.key in entry.part.occurrences)
    if (!holder) {
      appended.push(record)
      continue
    }
    const current = holder.entry.part.occurrences[record.key]
    const winner = newerOccurrence(current, record)
    if (winner === current) continue
    // Replacing a record can change its size by a few bytes; a part that would pass the budget
    // keeps its older copy and the newer record goes to another part (reads merge by key).
    const delta = PartSizer.entryBytes(record.key, record) - PartSizer.entryBytes(record.key, current)
    if (holder.sizer.size + delta > budgetBytes) {
      appended.push(record)
      continue
    }
    holder.entry.part.occurrences[record.key] = record
    holder.entry.changed = true
    holder.sizer = sizerFor(holder.entry.part)
  }

  const created: RoutineArchivePart[] = []
  // The part with the highest number; among duplicates of that number the lowest task id.
  const highest = working.reduce((max, { entry }) => Math.max(max, entry.part.part), 0)
  const last = working.find(({ entry }) => entry.part.part === highest)
  let target: { part: RoutineArchivePart; sizer: PartSizer; mark: () => void } | undefined = last
    ? { part: last.entry.part, sizer: last.sizer, mark: () => { last.entry.changed = true } }
    : undefined
  let nextNumber = highest + 1

  for (const record of appended) {
    const entry = PartSizer.entryBytes(record.key, record)
    if (!target || target.sizer.sizeWith(entry) > budgetBytes) {
      const fresh: RoutineArchivePart = { version: CURRENT_VERSION, routineId, part: nextNumber, occurrences: {} }
      nextNumber += 1
      created.push(fresh)
      const sizer = sizerFor(fresh)
      target = { part: fresh, sizer, mark: () => undefined }
    }
    target.part.occurrences[record.key] = record
    target.sizer.add(entry)
    target.mark()
  }

  return [
    ...mine.filter((entry) => entry.changed).map((entry): ArchiveOp => ({ kind: 'update', taskId: entry.taskId, part: entry.part })),
    ...created.map((part): ArchiveOp => ({ kind: 'create', part })),
  ]
}

/**
 * The history of one routine: the main carrier's occurrences plus every archive part for it (any
 * part number, duplicates allowed), merged per key with last-write-wins. Parts of other
 * routines are ignored.
 */
export function readRoutineHistory(
  routineId: string,
  main: Record<string, RoutineOccurrenceRecord>,
  parts: RoutineArchivePart[],
): Record<string, RoutineOccurrenceRecord> {
  const ordered = parts
    .filter((part) => part.routineId === routineId)
    .sort((left, right) => left.part - right.part)
  return mergeOccurrenceMaps(main, ...ordered.map((part) => part.occurrences))
}

// --- Display and export ------------------------------------------------------------------

export function timeLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60).toString().padStart(2, '0')
  const minute = (minutes % 60).toString().padStart(2, '0')
  return `${hour}:${minute}`
}

// --- Definition fields (section 6.7) ------------------------------------------------------
// The user sets a name, times and a schedule. The kind, and each slot's label and period, are
// still written because older app versions need them to read and edit the routine.

/** Older editors keep one time per period, and there are five periods. */
export const MAX_ROUTINE_TIMES = 5

const PERIOD_ORDER: RoutinePeriod[] = ['MORNING', 'AFTERNOON', 'EVENING', 'ANYTIME', 'HOME']

/** CHORE for an after-completion schedule; otherwise the stored kind, HEALTH for a new routine. */
export function routineKindFor(schedule: RoutineSchedule, stored?: RoutineKind): RoutineKind {
  return schedule.type === 'after_completion' ? 'CHORE' : stored ?? 'HEALTH'
}

/** The period a time falls in: before 12:00 morning, before 17:00 afternoon, otherwise evening. */
export function periodForMinutes(minutes: number): RoutinePeriod {
  if (minutes < 12 * 60) return 'MORNING'
  if (minutes < 17 * 60) return 'AFTERNOON'
  return 'EVENING'
}

/**
 * The slots in time order, each labelled with its time (`HH:MM`) and given a period no earlier
 * slot has (its own when free, else the first free one). Everything else on a slot is kept.
 */
export function normalizeRoutineSlots(slots: RoutineSlot[]): RoutineSlot[] {
  const taken = new Set<RoutinePeriod>()
  return [...slots]
    .sort((left, right) => left.reminderMinutes - right.reminderMinutes)
    .map((slot) => {
      const own = periodForMinutes(slot.reminderMinutes)
      const period = !taken.has(own) ? own : PERIOD_ORDER.find((candidate) => !taken.has(candidate)) ?? own
      taken.add(period)
      return { ...slot, label: timeLabel(slot.reminderMinutes), period }
    })
}

/**
 * One CSV cell, quoted. A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return
 * is prefixed with `'` so a spreadsheet does not run it as a formula.
 */
export function csvCell(value: string | number): string {
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export interface RoutineCsvEntry {
  name: string
  occurrences: Iterable<RoutineOccurrenceRecord>
}

export function csvForRoutines(entries: RoutineCsvEntry[]): string {
  const rows = entries.flatMap(({ name, occurrences }) => [...occurrences].map((occurrence) => [
    name,
    occurrence.scheduledDate,
    timeLabel(occurrence.scheduledMinutes),
    occurrence.status,
    occurrence.loggedAt,
    occurrence.timeZoneId,
    occurrence.note,
  ].map(csvCell).join(',')))
  return ['routine,scheduled_date,scheduled_time,status,logged_at,time_zone,note', ...rows.sort()].join('\n')
}
