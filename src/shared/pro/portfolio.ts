/**
 * The portfolio (docs/cross-app-semantics-v1.md section 21.10): ranked initiatives, the cap agreed
 * with the sponsor, parking, readiness, "log anyway", and escalations drafted on the second miss of a
 * promise. Both apps run the `pro.portfolio`, `pro.readiness` and `pro.escalationDraft` vectors (the
 * screens are desktop only).
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { type LocalDate } from '../due-dates'
import {
  finalVerdictOf,
  ledgerSettings,
  recordValue,
  type EscalationValue,
  type InitiativeValue,
  type ProLedger,
} from './ledger'
import { effectiveDue, missesOf } from './promises'

export interface RankedInitiative {
  projectId: number
  rank: number
  value: InitiativeValue
}

/** Active initiatives by rank (lowest first), then project id; ranks shown as 1, 2, 3 ... */
export function rankedInitiatives(ledger: ProLedger | null | undefined): RankedInitiative[] {
  const active: Array<{ projectId: number; rank: number; value: InitiativeValue }> = []
  for (const [id, record] of Object.entries(ledger?.initiatives ?? {})) {
    const value = record.value
    if (!value || (value.status ?? 'active') !== 'active') continue
    active.push({ projectId: Number(id), rank: typeof value.rank === 'number' ? value.rank : Number.MAX_SAFE_INTEGER, value })
  }
  active.sort((a, b) => a.rank - b.rank || a.projectId - b.projectId)
  return active.map((entry, index) => ({ ...entry, rank: index + 1 }))
}

/** The ranks after moving one active initiative to a 0-based place: every active one, 1 to n. */
export function moveRank(ledger: ProLedger, projectId: number, toIndex: number): Record<number, number> {
  const order = rankedInitiatives(ledger).map((entry) => entry.projectId)
  const from = order.indexOf(projectId)
  if (from < 0) return {}
  order.splice(from, 1)
  order.splice(Math.max(0, Math.min(toIndex, order.length)), 0, projectId)
  const ranks: Record<number, number> = {}
  order.forEach((id, index) => (ranks[id] = index + 1))
  return ranks
}

export interface CapState {
  active: number
  cap: number
  agreed: boolean
  /** Adding one more needs one parked first. */
  full: boolean
}

export function capState(ledger: ProLedger | null | undefined): CapState {
  const settings = ledger ? ledgerSettings(ledger) : { cap: 4, cap_agreed: null }
  const active = rankedInitiatives(ledger).length
  return { active, cap: settings.cap, agreed: !!settings.cap_agreed, full: active >= settings.cap }
}

/** Parking: status parked with the day and reason; the rank is dropped (it comes back last). */
export function parkedValue(value: InitiativeValue, on: LocalDate, reason: string): InitiativeValue {
  const next: InitiativeValue = { ...value, status: 'parked', parked: { on, reason: reason.trim() } }
  delete next.rank
  return next
}

/** Back to active, ranked last. */
export function unparkedValue(ledger: ProLedger, value: InitiativeValue): InitiativeValue {
  const next: InitiativeValue = { ...value, status: 'active', rank: rankedInitiatives(ledger).length + 1 }
  delete next.parked
  return next
}

// --- Readiness (decision 16) -------------------------------------------------------------------

export const READINESS_ITEMS = [
  'sponsor',
  'owner',
  'why',
  'done_looks_like',
  'smallest',
  'not_doing',
  'decision_rights',
  'capacity',
  'stop_if',
] as const
export type ReadinessItem = (typeof READINESS_ITEMS)[number]

export const READINESS_LABELS: Record<ReadinessItem, string> = {
  sponsor: 'Sponsor',
  owner: 'Owner',
  why: 'Why now',
  done_looks_like: 'Done looks like',
  smallest: 'Smallest useful step',
  not_doing: 'Not doing',
  decision_rights: 'Who decides what',
  capacity: 'Capacity agreed',
  stop_if: 'Stop if',
}

export interface ReadinessResult {
  done: number
  total: number
  missing: ReadinessItem[]
  ready: boolean
}

const filled = (value: unknown) => typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined

/** The nine items; text items count when not blank, capacity when agreed by someone on a day. */
export function readiness(value: InitiativeValue | null | undefined): ReadinessResult {
  const ready = value?.ready ?? {}
  const missing = READINESS_ITEMS.filter((item) => {
    if (item === 'sponsor' || item === 'owner') return typeof value?.[item] !== 'number'
    if (item === 'capacity') return !(ready.capacity && typeof ready.capacity.on === 'string')
    return !filled(ready[item])
  })
  return { done: READINESS_ITEMS.length - missing.length, total: READINESS_ITEMS.length, missing, ready: missing.length === 0 }
}

/** "Log anyway?": capture into an initiative that is not ready is allowed and counted. */
export function withLogAnyway(value: InitiativeValue): InitiativeValue {
  return { ...value, log_anyway: (value.log_anyway ?? 0) + 1 }
}

// --- Escalations (decision 15) -----------------------------------------------------------------

export interface EscalationTask {
  id: number
  title: string
  done?: boolean
  due_date?: string | null
}

/** True when the promise has reached the escalation threshold and has no escalation yet. */
export function escalationDue(ledger: ProLedger, taskId: number): boolean {
  const promise = recordValue(ledger.promises, taskId)
  if (!promise || promise.dir !== 'theirs' || finalVerdictOf(promise)) return false
  if (missesOf(promise) < ledgerSettings(ledger).threshold) return false
  return !Object.values(ledger.escalations).some((record) => record.value && record.value.promise === taskId)
}

export interface EscalationDraftInput {
  ledger: ProLedger
  taskId: number
  tasks: ReadonlyMap<number, EscalationTask>
  personName: (personId: number) => string
  projectName: (projectId: number) => string
  /** Words for a date in the draft ("Fri 20 Nov"). */
  dateText: (day: LocalDate) => string
  today: LocalDate
}

/**
 * The escalation draft: option A is the missed promise; option B is the same person's other open
 * promise of theirs in another initiative, the highest-ranked first (then the earliest due, then the
 * lowest id). Without one, the draft asks for help with A alone.
 */
export function draftEscalation(input: EscalationDraftInput): EscalationValue | null {
  const { ledger, taskId, tasks } = input
  const promise = recordValue(ledger.promises, taskId)
  const taskA = tasks.get(taskId)
  if (!promise || promise.person === null || !taskA) return null
  const ranks = new Map(rankedInitiatives(ledger).map((entry) => [entry.projectId, entry.rank]))
  const candidates: Array<{ id: number; rank: number; due: LocalDate | null }> = []
  for (const [id, record] of Object.entries(ledger.promises)) {
    const other = record.value
    const otherId = Number(id)
    const task = tasks.get(otherId)
    if (!other || otherId === taskId || !task || task.done) continue
    if (other.dir !== 'theirs' || other.person !== promise.person || finalVerdictOf(other)) continue
    if (typeof other.initiative !== 'number' || other.initiative === promise.initiative) continue
    candidates.push({ id: otherId, rank: ranks.get(other.initiative) ?? Number.MAX_SAFE_INTEGER, due: effectiveDue(task, other) })
  }
  candidates.sort((a, b) =>
    a.rank - b.rank ||
    (a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1) ||
    a.id - b.id)
  const b = candidates[0]?.id ?? null
  const name = input.personName(promise.person)
  const misses = missesOf(promise)
  const missedWord = misses === 2 ? 'twice' : `${misses} times`
  const dueA = effectiveDue(taskA, promise)
  const initiativeA = typeof promise.initiative === 'number' ? ` (${input.projectName(promise.initiative)})` : ''
  const lines = [`${name} has missed "${taskA.title.trim()}"${initiativeA} ${missedWord}${dueA ? `; it is now due ${input.dateText(dueA)}` : ''}.`]
  if (b !== null) {
    const other = recordValue(ledger.promises, b)!
    const taskB = tasks.get(b)!
    lines.push(`${name} is also working on "${taskB.title.trim()}" (${input.projectName(other.initiative as number)}).`)
    lines.push(`Which comes first? A: "${taskA.title.trim()}". B: "${taskB.title.trim()}".`)
  } else {
    lines.push('Can you help unblock it, or should we change what was agreed?')
  }
  return { promise: taskId, a: taskId, b, status: 'drafted', draft: lines.join(' '), decision: null, opened: input.today, resolved: null }
}
