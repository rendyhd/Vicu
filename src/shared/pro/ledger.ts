/**
 * The Pro ledger (docs/cross-app-semantics-v1.md section 21.7): one synced document per account with
 * the details of promises, initiatives, the logs, meetings and estimates. It is made of records like
 * the synced preferences (section 11.2): `{ value, revision }`, `null` a tombstone, unknown fields kept
 * at every level. Promise verdicts and "sent" marks are unions, so two devices never lose one. Both
 * apps run the `pro.ledgerMerge` and `pro.archive` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { diffLocalDays, type LocalDate } from '../due-dates'
import {
  canonicalJson,
  compareRevisions,
  HIDDEN_TASK_WRITE_MAX_BYTES,
  isSyncRevision,
  pruneTombstoneRecords,
  TOMBSTONE_MAX_AGE_MS,
  type SyncRevision,
} from '../hidden-tasks'

export const PRO_LEDGER_VERSION = 1

/** The collections made of records, in the order the contract lists them. */
export const LEDGER_COLLECTIONS = [
  'promises',
  'initiatives',
  'log',
  'owed',
  'escalations',
  'meetings',
  'rounds',
  'people',
] as const
export type LedgerCollection = (typeof LEDGER_COLLECTIONS)[number]

// --- Values -------------------------------------------------------------------------------------

/** Final kinds close a promise; `not_yet` and `renegotiated` keep it open with a new date. */
export const VERDICT_KINDS = ['delivered', 'late', 'not_yet', 'renegotiated', 'dropped', 'taken_over'] as const
export type VerdictKind = (typeof VERDICT_KINDS)[number]
export const FINAL_VERDICT_KINDS: readonly string[] = ['delivered', 'late', 'dropped', 'taken_over']

export interface Verdict {
  id: string
  /** UTC instant, ISO 8601. */
  at: string
  kind: VerdictKind | string
  /** The new date of a `not_yet` or `renegotiated` verdict (date-only). */
  new_due?: LocalDate | null
  blocker?: string | null
  /** Undo: an undone verdict stays in the list so the union cannot bring it back. */
  undone?: boolean
  [unknownField: string]: unknown
}

export type PromiseDirection = 'theirs' | 'mine'

export interface PromiseValue {
  /** `theirs`: someone promised it to you. `mine`: you owe it to them. */
  dir: PromiseDirection | string
  /** The label id of the person. */
  person: number | null
  words?: string | null
  done_when?: string | null
  /** The project id of the initiative. */
  initiative?: number | null
  /** Task ids of your promises it waits on. */
  needs?: number[]
  /** When a recap holding this promise was copied (UTC instants). */
  sent?: string[]
  verdicts?: Verdict[]
  [unknownField: string]: unknown
}

export interface Readiness {
  why?: string | null
  done_looks_like?: string | null
  smallest?: string | null
  not_doing?: string | null
  decision_rights?: string | null
  capacity?: { by: number | null; on: LocalDate } | null
  stop_if?: string | null
  [unknownField: string]: unknown
}

export type InitiativeStatus = 'active' | 'parked' | 'closed'

export interface InitiativeValue {
  rank?: number
  status?: InitiativeStatus | string
  sponsor?: number | null
  owner?: number | null
  ready?: Readiness
  parked?: { on: LocalDate; reason: string } | null
  closed_on?: LocalDate | null
  log_anyway?: number
  [unknownField: string]: unknown
}

export type LogKind = 'decision' | 'value' | 'unknown'

export interface LogValue {
  initiative?: number | null
  kind: LogKind | string
  text: string
  by?: number | null
  at: LocalDate
  /** For `unknown`: who to ask, and the task made for it. */
  ask?: number | null
  task?: number | null
  resolved?: LocalDate | null
  [unknownField: string]: unknown
}

export interface OwedValue {
  what: string
  from?: number | null
  initiative?: number | null
  opened: LocalDate
  resolved?: LocalDate | null
  [unknownField: string]: unknown
}

export type EscalationStatus = 'drafted' | 'accepted' | 'resolved' | 'dismissed'

export interface EscalationValue {
  promise: number
  a: number
  b: number | null
  status: EscalationStatus | string
  draft: string
  decision?: string | null
  opened: LocalDate
  resolved?: LocalDate | null
  [unknownField: string]: unknown
}

export interface MeetingValue {
  name: string
  people: number[]
  initiatives?: number[]
  rhythm?: string | null
  [unknownField: string]: unknown
}

export interface RoundValue {
  meeting: string
  at: LocalDate
  discussed: number[]
  skipped: number[]
  absent: number[]
  not_discussed: number[]
  [unknownField: string]: unknown
}

export interface PersonValue {
  aliases: string[]
  [unknownField: string]: unknown
}

export interface LedgerSettingsValue {
  cap?: number
  cap_agreed?: { by: number | null; on: LocalDate } | null
  rule_agreed_on?: LocalDate | null
  threshold?: number
  [unknownField: string]: unknown
}

export interface LedgerRecord<V> {
  value: V | null
  revision: SyncRevision
  [unknownField: string]: unknown
}

/** `[minutes, wall time in seconds]`; minutes `null` clears the estimate. The newer wall time wins. */
export type EstimateEntry = [number | null, number]

export interface ProLedger {
  version: number
  promises: Record<string, LedgerRecord<PromiseValue>>
  initiatives: Record<string, LedgerRecord<InitiativeValue>>
  log: Record<string, LedgerRecord<LogValue>>
  owed: Record<string, LedgerRecord<OwedValue>>
  escalations: Record<string, LedgerRecord<EscalationValue>>
  meetings: Record<string, LedgerRecord<MeetingValue>>
  rounds: Record<string, LedgerRecord<RoundValue>>
  people: Record<string, LedgerRecord<PersonValue>>
  estimates: Record<string, EstimateEntry>
  settings?: LedgerRecord<LedgerSettingsValue>
  [unknownField: string]: unknown
}

export const DEFAULT_CAP = 4
export const DEFAULT_ESCALATION_THRESHOLD = 2

export function emptyLedger(): ProLedger {
  return {
    version: PRO_LEDGER_VERSION,
    promises: {},
    initiatives: {},
    log: {},
    owed: {},
    escalations: {},
    meetings: {},
    rounds: {},
    people: {},
    estimates: {},
  }
}

// --- Reading -----------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Checks a decoded document and fills missing collections. A higher version is reported by the
 * caller before it gets here; anything else that does not fit is malformed.
 */
export function normalizeLedger(value: unknown): ProLedger {
  if (!isObject(value)) throw new Error('Pro ledger is invalid')
  if (value.version !== PRO_LEDGER_VERSION) throw new Error('Pro ledger version mismatch')
  const document: Record<string, unknown> = { ...value }
  for (const collection of LEDGER_COLLECTIONS) {
    const records = document[collection]
    if (records === undefined) {
      document[collection] = {}
      continue
    }
    if (!isObject(records)) throw new Error(`Pro ledger ${collection} is invalid`)
    for (const [id, record] of Object.entries(records)) {
      if (!isObject(record) || !isSyncRevision(record.revision)) throw new Error(`Pro ledger ${collection}.${id} is invalid`)
    }
  }
  const estimates = document.estimates
  if (estimates === undefined) document.estimates = {}
  else if (!isObject(estimates)) throw new Error('Pro ledger estimates are invalid')
  else {
    for (const [id, entry] of Object.entries(estimates)) {
      if (!isEstimateEntry(entry)) throw new Error(`Pro ledger estimate ${id} is invalid`)
    }
  }
  if (document.settings !== undefined && (!isObject(document.settings) || !isSyncRevision(document.settings.revision))) {
    throw new Error('Pro ledger settings are invalid')
  }
  return document as ProLedger
}

function isEstimateEntry(value: unknown): value is EstimateEntry {
  return Array.isArray(value) &&
    value.length >= 2 &&
    (value[0] === null || (typeof value[0] === 'number' && Number.isFinite(value[0]))) &&
    typeof value[1] === 'number' && Number.isFinite(value[1])
}

/** The value of a record, or null for a tombstone or a missing record. */
export function recordValue<V>(records: Record<string, LedgerRecord<V>> | undefined, id: string | number): V | null {
  const record = records?.[String(id)]
  return record && record.value !== null && record.value !== undefined ? record.value : null
}

/** The estimate of a task in minutes, or null. */
export function estimateOf(ledger: ProLedger, taskId: number): number | null {
  const entry = ledger.estimates[String(taskId)]
  return entry && typeof entry[0] === 'number' && entry[0] > 0 ? entry[0] : null
}

export function ledgerSettings(ledger: ProLedger): Required<Pick<LedgerSettingsValue, 'cap' | 'threshold'>> & LedgerSettingsValue {
  const value = ledger.settings?.value ?? {}
  const cap = typeof value.cap === 'number' && Number.isInteger(value.cap) && value.cap >= 1 ? value.cap : DEFAULT_CAP
  const threshold = typeof value.threshold === 'number' && Number.isInteger(value.threshold) && value.threshold >= 1
    ? value.threshold
    : DEFAULT_ESCALATION_THRESHOLD
  return { ...value, cap, threshold }
}

// --- Merge (section 21.7) ----------------------------------------------------------------------

/** Verdicts of both sides by id; an undone verdict wins, else the side whose record won. */
function unionVerdicts(winner: Verdict[] | undefined, loser: Verdict[] | undefined): Verdict[] | undefined {
  if (!winner && !loser) return undefined
  const byId = new Map<string, Verdict>()
  for (const verdict of loser ?? []) byId.set(verdict.id, verdict)
  for (const verdict of winner ?? []) {
    const other = byId.get(verdict.id)
    byId.set(verdict.id, other?.undone === true && verdict.undone !== true ? other : verdict)
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function unionSent(winner: string[] | undefined, loser: string[] | undefined): string[] | undefined {
  if (!winner && !loser) return undefined
  return [...new Set([...(winner ?? []), ...(loser ?? [])])].sort()
}

function mergeRecords<V>(
  collection: string,
  local: Record<string, LedgerRecord<V>>,
  server: Record<string, LedgerRecord<V>>,
): Record<string, LedgerRecord<V>> {
  const merged: Record<string, LedgerRecord<V>> = {}
  for (const id of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const mine = local[id]
    const theirs = server[id]
    if (!mine || !theirs) {
      merged[id] = mine ?? theirs
      continue
    }
    const localWins = compareRevisions(mine.revision, theirs.revision) > 0
    const winner = localWins ? mine : theirs
    const loser = localWins ? theirs : mine
    if (collection === 'promises' && winner.value && loser.value) {
      const value = { ...(winner.value as unknown as PromiseValue) }
      const other = loser.value as unknown as PromiseValue
      const verdicts = unionVerdicts(value.verdicts, other.verdicts)
      const sent = unionSent(value.sent, other.sent)
      if (verdicts) value.verdicts = verdicts
      if (sent) value.sent = sent
      merged[id] = { ...winner, value: value as unknown as V }
    } else {
      merged[id] = winner
    }
  }
  return merged
}

function mergeEstimates(local: Record<string, EstimateEntry>, server: Record<string, EstimateEntry>): Record<string, EstimateEntry> {
  const merged: Record<string, EstimateEntry> = {}
  for (const id of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const mine = local[id]
    const theirs = server[id]
    merged[id] = !mine ? theirs : !theirs ? mine : mine[1] > theirs[1] ? mine : theirs
  }
  return merged
}

/**
 * `merge(local, server)`: per record the newer revision wins (equal revisions keep the server's),
 * except that two values of a promise keep the union of their verdicts (by id) and "sent" marks.
 * Estimates: the newer wall time wins. Unknown top-level fields are the union, the server's kept.
 * No pruning here.
 */
export function mergeLedger(local: ProLedger, server: ProLedger): ProLedger {
  const merged: ProLedger = { ...local, ...server } as ProLedger
  for (const collection of LEDGER_COLLECTIONS) {
    const records = (document: ProLedger) => (document[collection] ?? {}) as Record<string, LedgerRecord<unknown>>
    ;(merged as unknown as Record<string, unknown>)[collection] = mergeRecords(collection, records(local), records(server))
  }
  merged.estimates = mergeEstimates(local.estimates ?? {}, server.estimates ?? {})
  const mine = local.settings
  const theirs = server.settings
  const settings = !mine ? theirs : !theirs ? mine : compareRevisions(mine.revision, theirs.revision) > 0 ? mine : theirs
  if (settings) merged.settings = settings
  else delete merged.settings
  return merged
}

/** The document without tombstones (records and cleared estimates) older than 90 days before `now`. */
export function pruneLedger(ledger: ProLedger, now: number): ProLedger {
  const pruned: ProLedger = { ...ledger }
  for (const collection of LEDGER_COLLECTIONS) {
    ;(pruned as unknown as Record<string, unknown>)[collection] = pruneTombstoneRecords((ledger[collection] ?? {}) as Record<string, LedgerRecord<unknown>>, now)
  }
  const estimates: Record<string, EstimateEntry> = {}
  for (const [id, entry] of Object.entries(ledger.estimates ?? {})) {
    if (entry[0] === null && entry[1] * 1000 < now - TOMBSTONE_MAX_AGE_MS) continue
    estimates[id] = entry
  }
  pruned.estimates = estimates
  return pruned
}

export function sameLedger(left: ProLedger, right: ProLedger): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

/** True when the document holds anything (only then is a carrier created). */
export function hasLedgerContent(ledger: ProLedger): boolean {
  return LEDGER_COLLECTIONS.some((collection) => Object.keys(ledger[collection] ?? {}).length > 0) ||
    Object.keys(ledger.estimates ?? {}).length > 0 ||
    ledger.settings !== undefined
}

// --- Changes -----------------------------------------------------------------------------------

function allRevisions(ledger: ProLedger): SyncRevision[] {
  const revisions: SyncRevision[] = []
  for (const collection of LEDGER_COLLECTIONS) {
    for (const record of Object.values(ledger[collection] ?? {})) revisions.push(record.revision)
  }
  if (ledger.settings) revisions.push(ledger.settings.revision)
  return revisions
}

/** The revision for a change made now on this device: newer than every revision in the document. */
export function nextLedgerRevision(ledger: ProLedger, deviceId: string, now: number): SyncRevision {
  const revisions = allRevisions(ledger)
  const maxWall = revisions.reduce((max, revision) => Math.max(max, revision.wall_time_ms), 0)
  const wallTime = Math.max(now, maxWall)
  const maxCounter = revisions
    .filter((revision) => revision.wall_time_ms === wallTime)
    .reduce((max, revision) => Math.max(max, revision.counter), -1)
  return { wall_time_ms: wallTime, counter: wallTime === now && now > maxWall ? 0 : maxCounter + 1, device_id: deviceId }
}

/** The document with one record set (`null` deletes it). The record's unknown fields stay. */
export function setLedgerRecord<C extends LedgerCollection>(
  ledger: ProLedger,
  collection: C,
  id: string | number,
  value: ProLedger[C][string]['value'],
  deviceId: string,
  now: number,
): ProLedger {
  const revision = nextLedgerRevision(ledger, deviceId, now)
  const records = ledger[collection] ?? {}
  const previous = records[String(id)]
  return {
    ...ledger,
    [collection]: { ...records, [String(id)]: { ...(previous ?? {}), value: value ?? null, revision } },
  }
}

export function setLedgerSettings(ledger: ProLedger, value: LedgerSettingsValue, deviceId: string, now: number): ProLedger {
  const revision = nextLedgerRevision(ledger, deviceId, now)
  return { ...ledger, settings: { ...(ledger.settings ?? {}), value, revision } }
}

/** Sets (or, with `null` minutes, clears) a task's estimate. */
export function setEstimate(ledger: ProLedger, taskId: number, minutes: number | null, now: number): ProLedger {
  const previous = ledger.estimates[String(taskId)]
  const wall = Math.max(Math.floor(now / 1000), previous ? previous[1] + 1 : 0)
  const value = minutes !== null && minutes > 0 ? Math.round(minutes) : null
  return { ...ledger, estimates: { ...ledger.estimates, [String(taskId)]: [value, wall] } }
}

/**
 * A task created offline has a temporary (negative) id until the replay creates it. Renames every
 * place the ledger names that task: the promise and estimate keys, needs, escalations and log tasks.
 */
export function remapLedgerTaskId(ledger: ProLedger, from: number, to: number): ProLedger {
  const rename = (id: number | null | undefined) => (id === from ? to : id)
  const next: ProLedger = { ...ledger }
  const promises: ProLedger['promises'] = {}
  for (const [id, record] of Object.entries(ledger.promises)) {
    const key = id === String(from) ? String(to) : id
    const value = record.value
    promises[key] = value && value.needs?.includes(from)
      ? { ...record, value: { ...value, needs: value.needs.map((need) => (need === from ? to : need)) } }
      : record
  }
  next.promises = promises
  const estimates: ProLedger['estimates'] = {}
  for (const [id, entry] of Object.entries(ledger.estimates)) estimates[id === String(from) ? String(to) : id] = entry
  next.estimates = estimates
  const escalations: ProLedger['escalations'] = {}
  for (const [id, record] of Object.entries(ledger.escalations)) {
    const value = record.value
    escalations[id] = value && (value.promise === from || value.a === from || value.b === from)
      ? { ...record, value: { ...value, promise: rename(value.promise) as number, a: rename(value.a) as number, b: rename(value.b) ?? null } }
      : record
  }
  next.escalations = escalations
  const log: ProLedger['log'] = {}
  for (const [id, record] of Object.entries(ledger.log)) {
    log[id] = record.value && record.value.task === from ? { ...record, value: { ...record.value, task: to } } : record
  }
  next.log = log
  return next
}

// --- Size and archive (section 21.7) -----------------------------------------------------------

/** The sync status warns when the main carrier's JSON passes this many bytes (70 percent of the cap). */
export const LEDGER_WARN_BYTES = Math.floor(HIDDEN_TASK_WRITE_MAX_BYTES * 0.7)
/** Records closed for longer than this move to the archive parts. */
export const ARCHIVE_AFTER_DAYS = 180

export function ledgerJsonBytes(ledger: unknown): number {
  return new TextEncoder().encode(JSON.stringify(ledger)).length
}

/** The quarter a local date is in: `2026-Q3`. */
export function quarterOf(day: LocalDate): string {
  const [year, month] = day.split('-').map(Number)
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
}

const dayOfInstant = (value: string): LocalDate | null => {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
}
const isLocalDate = (value: unknown): value is LocalDate => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** The verdicts that count: not undone, in the order given. */
export function activeVerdicts(promise: PromiseValue | null | undefined): Verdict[] {
  return (promise?.verdicts ?? []).filter((verdict) => verdict.undone !== true)
}

/** The final verdict that closed a promise, or null while it is open. */
export function finalVerdictOf(promise: PromiseValue | null | undefined): Verdict | null {
  const verdicts = activeVerdicts(promise)
  const last = verdicts[verdicts.length - 1]
  return last && FINAL_VERDICT_KINDS.includes(last.kind) ? last : null
}

/** The local day a record was closed, or null while it is open (or never closes). */
export function closedOn(collection: LedgerCollection, value: unknown): LocalDate | null {
  if (!isObject(value)) return null
  switch (collection) {
    case 'promises': {
      const final = finalVerdictOf(value as PromiseValue)
      return final ? dayOfInstant(final.at) : null
    }
    case 'initiatives':
      return value.status === 'closed' && isLocalDate(value.closed_on) ? value.closed_on : null
    case 'log':
      if (value.kind === 'unknown') return isLocalDate(value.resolved) ? value.resolved : null
      return isLocalDate(value.at) ? value.at : null
    case 'owed':
    case 'escalations':
      return isLocalDate(value.resolved) ? value.resolved : null
    case 'rounds':
      return isLocalDate(value.at) ? value.at : null
    default:
      return null
  }
}

export type ArchiveRecords = Partial<Record<LedgerCollection, Record<string, LedgerRecord<unknown>>>>

export interface ArchivePlan {
  /** By quarter, the records to add to that archive part. */
  parts: Record<string, ArchiveRecords>
  /** The records to replace with tombstones once the parts are written. */
  moved: Array<{ collection: LedgerCollection; id: string }>
}

/** Records closed more than 180 days before `today`, by the quarter they were closed in. */
export function archivePlan(ledger: ProLedger, today: LocalDate): ArchivePlan {
  const plan: ArchivePlan = { parts: {}, moved: [] }
  for (const collection of LEDGER_COLLECTIONS) {
    for (const [id, record] of Object.entries(ledger[collection] ?? {})) {
      const day = closedOn(collection, record.value)
      if (day === null || diffLocalDays(day, today) <= ARCHIVE_AFTER_DAYS) continue
      const quarter = quarterOf(day)
      const part = (plan.parts[quarter] ??= {})
      ;(part[collection] ??= {})[id] = record as LedgerRecord<unknown>
      plan.moved.push({ collection, id })
    }
  }
  plan.moved.sort((a, b) => (a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return plan
}

/** The document with the moved records replaced by tombstones (one revision for all of them). */
export function tombstoneMoved(ledger: ProLedger, moved: ArchivePlan['moved'], deviceId: string, now: number): ProLedger {
  if (moved.length === 0) return ledger
  const revision = nextLedgerRevision(ledger, deviceId, now)
  const next: ProLedger = { ...ledger }
  for (const { collection, id } of moved) {
    const records = { ...(next[collection] as Record<string, LedgerRecord<unknown>>) }
    const { value: _value, ...rest } = records[id] ?? {}
    records[id] = { ...rest, value: null, revision }
    ;(next as unknown as Record<string, unknown>)[collection] = records
  }
  return next
}

/** An archive part's document: the moved records of one quarter. Merged like the ledger. */
export interface ProArchivePart extends ArchiveRecords {
  version: number
  quarter: string
  [unknownField: string]: unknown
}

export function emptyArchivePart(quarter: string): ProArchivePart {
  return { version: PRO_LEDGER_VERSION, quarter }
}

/** An archive part with more records added (a record already there keeps the newer revision). */
export function addToArchivePart(part: ProArchivePart, records: ArchiveRecords): ProArchivePart {
  const next: ProArchivePart = { ...part }
  for (const collection of LEDGER_COLLECTIONS) {
    const incoming = records[collection]
    if (!incoming) continue
    next[collection] = mergeRecords<unknown>(collection, part[collection] ?? {}, incoming)
  }
  return next
}
