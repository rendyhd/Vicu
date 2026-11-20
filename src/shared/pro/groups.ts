/**
 * Groups and their actions (docs/cross-app-semantics-v1.md section 21.16): a group is a meeting with
 * a label; an action is a task that carries that label. The group's page, the reliability counts,
 * the issue a second miss adds, and a person's page split by who a promise was made to (21.5).
 * Both apps run the `pro.groups`, `pro.groupPage`, `pro.reliability`, `pro.missIssue` and
 * `pro.personPage` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, isNoDueDate, localDateOf, type LocalDate } from '../due-dates'
import {
  activeVerdicts,
  finalVerdictOf,
  recordValue,
  type GroupSession,
  type LogValue,
  type MeetingValue,
  type PromiseValue,
  type ProLedger,
  type RoundValue,
} from './ledger'
import { effectiveDue, missesOf, requesterOf, type PromiseTask } from './promises'

/** You, as an owner (the same value as your card in a meeting round). */
export const YOU = 0

export interface Group {
  /** The meeting record's id. */
  id: string
  /** The group's label id. */
  label: number
  name: string
  /** The members (person label ids), in order. */
  people: number[]
  sessions: GroupSession[]
  /** False when checks before due are off for this group. */
  checks: boolean
  language: string | null
}

const isLabelId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0

function groupFrom(id: string, value: MeetingValue): Group | null {
  if (!isLabelId(value.label)) return null
  const sessions = Array.isArray(value.sessions)
    ? value.sessions.filter((session): session is GroupSession => !!session && typeof session === 'object' && typeof session.id === 'string' && typeof session.kind === 'string')
    : []
  return {
    id,
    label: value.label,
    name: typeof value.name === 'string' ? value.name : '',
    people: [...new Set((Array.isArray(value.people) ? value.people : []).filter(isLabelId))],
    sessions,
    checks: value.checks !== false,
    language: typeof value.language === 'string' && value.language.trim() ? value.language.trim() : null,
  }
}

/**
 * The groups: meetings with a label. Two meetings naming one label: the lower id (as text) is the
 * group. By name (case ignored), then id.
 */
export function groupsOf(ledger: ProLedger | null | undefined): Group[] {
  const byLabel = new Map<number, Group>()
  for (const id of Object.keys(ledger?.meetings ?? {}).sort()) {
    const value = recordValue(ledger?.meetings, id)
    const group = value ? groupFrom(id, value) : null
    if (group && !byLabel.has(group.label)) byLabel.set(group.label, group)
  }
  return [...byLabel.values()].sort((a, b) => {
    const left = a.name.toLowerCase()
    const right = b.name.toLowerCase()
    return left < right ? -1 : left > right ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function groupOfLabel(ledger: ProLedger | null | undefined, label: number): Group | null {
  return groupsOf(ledger).find((group) => group.label === label) ?? null
}

export function groupOfMeeting(ledger: ProLedger | null | undefined, meetingId: string): Group | null {
  return groupsOf(ledger).find((group) => group.id === meetingId) ?? null
}

export interface GroupTask extends PromiseTask {
  /** When the task was created (UTC instant). */
  created?: string | null
}

const hasLabel = (task: PromiseTask, label: number) => (task.labels ?? []).some((entry) => entry.id === label)

/** The tasks that carry the group's label. */
export function actionsOf<T extends PromiseTask>(tasks: readonly T[], label: number): T[] {
  return tasks.filter((task) => hasLabel(task, label))
}

/**
 * An action's owner: the promise's person when it is theirs, `YOU` when it is yours, else nobody.
 */
export function ownerOf(promise: PromiseValue | null | undefined): number | null {
  if (!promise) return null
  if (promise.dir === 'mine') return YOU
  if (promise.dir === 'theirs' && isLabelId(promise.person)) return promise.person
  return null
}

/** The day an action is due now: the promise's effective due day, the task's without a promise. */
export function actionDue(task: PromiseTask, promise: PromiseValue | null | undefined): LocalDate | null {
  if (promise) return effectiveDue(task, promise)
  return isNoDueDate(task.due_date) ? null : localDateOf(task.due_date)
}

/** Owners in the group's order, then other people by id, then you, then nobody. */
export function ownerRank(group: Pick<Group, 'people'>, owner: number | null): [number, number] {
  if (owner === null) return [3, 0]
  if (owner === YOU) return [2, 0]
  const index = group.people.indexOf(owner)
  return index >= 0 ? [0, index] : [1, owner]
}

const byDueThenId = (a: { due: LocalDate | null; id: number }, b: { due: LocalDate | null; id: number }) =>
  a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1

export interface OwnerActions {
  /** A person's label id, `YOU`, or null for no owner. */
  owner: number | null
  tasks: number[]
}

interface Row {
  id: number
  owner: number | null
  due: LocalDate | null
}

function byOwner(group: Pick<Group, 'people'>, rows: readonly Row[]): OwnerActions[] {
  const owners = new Map<number | null, Row[]>()
  for (const row of rows) owners.set(row.owner, [...(owners.get(row.owner) ?? []), row])
  return [...owners.entries()]
    .sort(([a], [b]) => {
      const left = ownerRank(group, a)
      const right = ownerRank(group, b)
      return left[0] - right[0] || left[1] - right[1]
    })
    .map(([owner, list]) => ({ owner, tasks: [...list].sort(byDueThenId).map((row) => row.id) }))
}

/** When the group's last session ended (a UTC instant), or null when it had none. */
export function lastSessionEnd(ledger: ProLedger | null | undefined, meetingId: string): string | null {
  let latest: string | null = null
  for (const record of Object.values(ledger?.rounds ?? {})) {
    const round = record.value as RoundValue | null
    if (!round || round.meeting !== meetingId || typeof round.ended !== 'string') continue
    if (latest === null || new Date(round.ended).getTime() > new Date(latest).getTime()) latest = round.ended
  }
  return latest
}

export interface GroupPage {
  /** When the last session ended, or null. */
  since: string | null
  /** Your own open actions for the group. */
  yours: number[]
  overdue: OwnerActions[]
  due: OwnerActions[]
  /** Created since the last session. */
  fresh: OwnerActions[]
  open: OwnerActions[]
  done: OwnerActions[]
  /** Open actions without an owner (they are also in their part). */
  noOwner: number[]
}

export interface GroupPageInput {
  group: Group
  /** Tasks with the group's label, open and done; others are ignored. */
  tasks: readonly GroupTask[]
  ledger: ProLedger | null | undefined
  today: LocalDate
}

/**
 * The group's page: every action in one part (section 21.16). Open ones, the first that fits:
 * yours, overdue, due, new, open; done ones completed after the last session (or in the last 7 days
 * without one).
 */
export function groupPage(input: GroupPageInput): GroupPage {
  const { group, ledger, today } = input
  const since = lastSessionEnd(ledger, group.id)
  const sinceMs = since === null ? null : new Date(since).getTime()
  const sinceDay = since === null ? null : localDateOf(since)
  const parts: Record<'overdue' | 'due' | 'fresh' | 'open' | 'done', Row[]> = { overdue: [], due: [], fresh: [], open: [], done: [] }
  const yours: Row[] = []
  const noOwner: number[] = []
  const weekAgo = addLocalDays(today, -6)
  for (const task of actionsOf(input.tasks, group.label)) {
    const promise = recordValue(ledger?.promises, task.id)
    const row: Row = { id: task.id, owner: ownerOf(promise), due: actionDue(task, promise) }
    if (task.done) {
      const doneAt = task.done_at && !isNoDueDate(task.done_at) ? task.done_at : null
      if (!doneAt) continue
      const counts = sinceMs !== null ? new Date(doneAt).getTime() > sinceMs : localDateOf(doneAt) >= weekAgo
      if (counts) parts.done.push(row)
      continue
    }
    if (row.owner === null) noOwner.push(task.id)
    if (row.owner === YOU) {
      yours.push(row)
    } else if (sinceDay !== null && row.due !== null && row.due <= sinceDay) {
      parts.overdue.push(row)
    } else if (row.due !== null && row.due <= today) {
      parts.due.push(row)
    } else if (sinceMs !== null && task.created && new Date(task.created).getTime() > sinceMs) {
      parts.fresh.push(row)
    } else {
      parts.open.push(row)
    }
  }
  return {
    since,
    yours: [...yours].sort(byDueThenId).map((row) => row.id),
    overdue: byOwner(group, parts.overdue),
    due: byOwner(group, parts.due),
    fresh: byOwner(group, parts.fresh),
    open: byOwner(group, parts.open),
    done: byOwner(group, parts.done),
    noOwner: noOwner.sort((a, b) => a - b),
  }
}

// --- Reliability --------------------------------------------------------------------------------

export const RELIABILITY_SESSIONS = 4

export interface Reliability {
  /** How many sessions the counts cover: 1 to 4. */
  sessions: number
  /** The first local day of the window. */
  from: LocalDate
  onTime: number
  late: number
  dropped: number
  takenOver: number
  openPastDue: number
  total: number
}

/** The group's ended sessions, newest first. */
export function endedSessions(ledger: ProLedger | null | undefined, meetingId: string): Array<{ id: string; value: RoundValue }> {
  const list: Array<{ id: string; value: RoundValue }> = []
  for (const [id, record] of Object.entries(ledger?.rounds ?? {})) {
    const round = record.value as RoundValue | null
    if (round && round.meeting === meetingId && typeof round.ended === 'string') list.push({ id, value: round })
  }
  return list.sort((a, b) => {
    const left = new Date(a.value.ended as string).getTime()
    const right = new Date(b.value.ended as string).getTime()
    return right - left || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

/**
 * Counts over the group's last four ended sessions, or null without one. The window runs from the
 * day after the fifth-last session's day, or from the earliest of them, through today.
 */
export function reliability(input: GroupPageInput): Reliability | null {
  const { group, ledger, today } = input
  const sessions = endedSessions(ledger, group.id)
  if (!sessions.length) return null
  const covered = sessions.slice(0, RELIABILITY_SESSIONS)
  const before = sessions[RELIABILITY_SESSIONS]
  const from = before ? addLocalDays(before.value.at, 1) : covered[covered.length - 1].value.at
  const counts: Reliability = { sessions: covered.length, from, onTime: 0, late: 0, dropped: 0, takenOver: 0, openPastDue: 0, total: 0 }
  for (const task of actionsOf(input.tasks, group.label)) {
    const promise = recordValue(ledger?.promises, task.id)
    if (!promise || promise.dir !== 'theirs') continue
    const final = finalVerdictOf(promise)
    if (final) {
      const day = localDateOf(final.at)
      if (day < from || day > today) continue
      if (final.kind === 'delivered') counts.onTime++
      else if (final.kind === 'late') counts.late++
      else if (final.kind === 'dropped') counts.dropped++
      else if (final.kind === 'taken_over') counts.takenOver++
      else continue
      counts.total++
    } else if (!task.done) {
      const due = effectiveDue(task, promise)
      if (due !== null && due < today) {
        counts.openPastDue++
        counts.total++
      }
    }
  }
  return counts
}

// --- Decisions, questions and issues ------------------------------------------------------------

export interface LogEntry {
  id: string
  value: LogValue
}

/** A group's log entries of one kind, newest first (`at`, then id). */
export function groupLog(ledger: ProLedger | null | undefined, label: number, kind: string): LogEntry[] {
  const entries: LogEntry[] = []
  for (const [id, record] of Object.entries(ledger?.log ?? {})) {
    const value = record.value
    if (value && value.group === label && value.kind === kind) entries.push({ id, value })
  }
  return entries.sort((a, b) => (a.value.at === b.value.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.value.at < b.value.at ? 1 : -1))
}

/** The group's open issues: by rank (lowest first, without one last), then `at`, then id. */
export function openIssues(ledger: ProLedger | null | undefined, label: number): LogEntry[] {
  const rankOf = (entry: LogEntry) => (typeof entry.value.rank === 'number' && Number.isFinite(entry.value.rank) ? entry.value.rank : null)
  return groupLog(ledger, label, 'issue')
    .filter((entry) => !entry.value.resolved)
    .sort((a, b) => {
      const left = rankOf(a)
      const right = rankOf(b)
      if (left !== right) return left === null ? 1 : right === null ? -1 : left - right
      if (a.value.at !== b.value.at) return a.value.at < b.value.at ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * The issue a second miss adds (section 21.16): when the action has exactly `threshold` misses and
 * no open issue of the group names it. Null otherwise.
 */
export function missIssue(
  ledger: ProLedger | null | undefined,
  task: { id: number; title?: string },
  label: number,
  today: LocalDate,
  threshold: number,
): LogValue | null {
  const promise = recordValue(ledger?.promises, task.id)
  if (!promise || promise.dir !== 'theirs' || finalVerdictOf(promise)) return null
  if (missesOf(promise) !== threshold) return null
  if (openIssues(ledger, label).some((entry) => entry.value.task === task.id)) return null
  return { kind: 'issue', text: (task.title ?? '').trim(), at: today, group: label, task: task.id }
}

// --- A person's page (section 21.5) -------------------------------------------------------------

export interface PersonPart {
  /** The group's label id, or null for promises outside a group. */
  group: number | null
  tasks: number[]
}

export interface PersonPage {
  toYou: PersonPart[]
  toOthers: PersonPart[]
}

/**
 * A person's open promises of theirs, split by who they were made to, and each by group (the
 * promise's `to.group`, else the lowest group label on the task, else none): without a group first,
 * then by label id; tasks by effective due day (none last), then id.
 */
export function personPage(
  personId: number,
  tasks: readonly PromiseTask[],
  ledger: ProLedger | null | undefined,
  groupLabels: ReadonlySet<number>,
): PersonPage {
  const toYou = new Map<number | null, Row[]>()
  const toOthers = new Map<number | null, Row[]>()
  for (const task of tasks) {
    if (task.done) continue
    const promise = recordValue(ledger?.promises, task.id)
    if (!promise || promise.dir !== 'theirs' || promise.person !== personId || finalVerdictOf(promise)) continue
    const requester = requesterOf(promise)
    const onTask = (task.labels ?? []).map((label) => label.id).filter((id) => groupLabels.has(id)).sort((a, b) => a - b)
    const group = requester.kind === 'group' ? requester.group : onTask[0] ?? null
    const target = requester.kind === 'you' ? toYou : toOthers
    target.set(group, [...(target.get(group) ?? []), { id: task.id, owner: personId, due: effectiveDue(task, promise) }])
  }
  const parts = (map: Map<number | null, Row[]>): PersonPart[] =>
    [...map.entries()]
      .sort(([a], [b]) => (a === null ? (b === null ? 0 : -1) : b === null ? 1 : a - b))
      .map(([group, rows]) => ({ group, tasks: [...rows].sort(byDueThenId).map((row) => row.id) }))
  return { toYou: parts(toYou), toOthers: parts(toOthers) }
}

/** Verdicts on a promise given from `from` through `to` (UTC instants), in order. */
export function verdictsBetween(promise: PromiseValue | null | undefined, from: string, to: string): ReturnType<typeof activeVerdicts> {
  const start = new Date(from).getTime()
  const end = new Date(to).getTime()
  return activeVerdicts(promise).filter((verdict) => {
    const at = new Date(verdict.at).getTime()
    return at >= start && at <= end
  })
}
