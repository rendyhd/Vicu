/**
 * Sessions (docs/cross-app-semantics-v1.md section 21.17): one meeting of a group, of a kind. The
 * steps of a kind, the order of the actions step, what a session held (worked out from its times,
 * never stored), and the round written at the end. Both apps run the `pro.sessions` vectors (the
 * session itself runs on desktop and web only).
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { endOfWeek, type LocalDate } from '../due-dates'
import type { WeekStart } from '../week-start'
import { activeVerdicts, recordValue, type ProLedger, type RoundValue, type Verdict } from './ledger'
import { actionDue, actionsOf, ownerOf, ownerRank, verdictsBetween, type Group, type GroupTask } from './groups'
import { needsVerdict } from './promises'

export type SessionKind = 'weekly' | 'standup'
export const SESSION_KINDS: readonly SessionKind[] = ['weekly', 'standup']

/** Other kinds are kept in the record and run as `weekly`. */
export function sessionKindOf(kind: unknown): SessionKind {
  return kind === 'standup' ? 'standup' : 'weekly'
}

export type SessionStep = 'actions' | 'issues' | 'new' | 'readback'

export const SESSION_STEPS: Record<SessionKind, readonly SessionStep[]> = {
  weekly: ['actions', 'issues', 'new', 'readback'],
  standup: ['actions', 'new', 'readback'],
}

export interface SessionActions {
  /** Open actions that need a verdict, in order. */
  verdicts: number[]
  /** The other open actions, in order. */
  others: number[]
}

export interface SessionActionsInput {
  group: Group
  /** Tasks with the group's label; done ones are left out. */
  tasks: readonly GroupTask[]
  ledger: ProLedger | null | undefined
  today: LocalDate
  kind: SessionKind
  weekStart: WeekStart
}

/**
 * The actions step: the group's open actions, first those that need a verdict, then the others;
 * in a stand-up only those due on or before the last day of this week. Each list in the owner
 * order (the group's people, other people by id, you, nobody), then due day (none last), then id.
 */
export function sessionActions(input: SessionActionsInput): SessionActions {
  const { group, ledger, today } = input
  const weekEnd = endOfWeek(today, input.weekStart)
  const rows: Array<{ id: number; owner: number | null; due: LocalDate | null; verdict: boolean }> = []
  for (const task of actionsOf(input.tasks, group.label)) {
    if (task.done) continue
    const promise = recordValue(ledger?.promises, task.id)
    const due = actionDue(task, promise)
    if (input.kind === 'standup' && (due === null || due > weekEnd)) continue
    rows.push({ id: task.id, owner: ownerOf(promise), due, verdict: needsVerdict(task, promise, today) })
  }
  rows.sort((a, b) => {
    const left = ownerRank(group, a.owner)
    const right = ownerRank(group, b.owner)
    if (left[0] !== right[0]) return left[0] - right[0]
    if (left[1] !== right[1]) return left[1] - right[1]
    if (a.due !== b.due) return a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
    return a.id - b.id
  })
  return { verdicts: rows.filter((row) => row.verdict).map((row) => row.id), others: rows.filter((row) => !row.verdict).map((row) => row.id) }
}

export interface SessionContents {
  /** The last verdict given in the session on each action, by task id. */
  verdicts: Array<{ taskId: number; verdict: Verdict }>
  /** Actions created in the session, by id. */
  created: number[]
  /** Log entry ids captured in the session, by kind, in `at` then id order. */
  decisions: string[]
  questions: string[]
  issues: string[]
  /** Issues solved in the session. */
  solved: string[]
  /** Blockers, commitments and stops captured in the session. */
  blockers: string[]
  commitments: string[]
  stops: string[]
}

export interface SessionContentsInput {
  /** The round's id (chosen when the session started). */
  round: string
  started: string
  ended: string
  group: Group
  /** Tasks with the group's label, open and done. */
  tasks: readonly GroupTask[]
  ledger: ProLedger | null | undefined
}

/** What a session held (section 21.17): worked out from its times and the log's `session`. */
export function sessionContents(input: SessionContentsInput): SessionContents {
  const { ledger, group } = input
  const start = new Date(input.started).getTime()
  const end = new Date(input.ended).getTime()
  const verdicts: SessionContents['verdicts'] = []
  const created: number[] = []
  for (const task of actionsOf(input.tasks, group.label)) {
    const given = verdictsBetween(recordValue(ledger?.promises, task.id), input.started, input.ended)
    if (given.length) verdicts.push({ taskId: task.id, verdict: given[given.length - 1] })
    if (task.created) {
      const at = new Date(task.created).getTime()
      if (at >= start && at <= end) created.push(task.id)
    }
  }
  verdicts.sort((a, b) => a.taskId - b.taskId)
  created.sort((a, b) => a - b)
  const byKind: Record<string, Array<{ id: string; at: string }>> = { decision: [], unknown: [], issue: [], blocker: [], commitment: [], stop: [] }
  const solved: Array<{ id: string; at: string }> = []
  for (const [id, record] of Object.entries(ledger?.log ?? {})) {
    const value = record.value
    if (!value) continue
    if (value.session === input.round && byKind[value.kind]) byKind[value.kind].push({ id, at: value.at })
    if (value.kind === 'issue' && value.solved_in === input.round) solved.push({ id, at: value.at })
  }
  const ids = (list: Array<{ id: string; at: string }>) =>
    [...list].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.at < b.at ? -1 : 1)).map((entry) => entry.id)
  return {
    verdicts,
    created,
    decisions: ids(byKind.decision),
    questions: ids(byKind.unknown),
    issues: ids(byKind.issue),
    solved: ids(solved),
    blockers: ids(byKind.blocker),
    commitments: ids(byKind.commitment),
    stops: ids(byKind.stop),
  }
}

export interface SessionEnd {
  meeting: string
  kind: string
  /** The local day the session started on. */
  at: LocalDate
  started: string
  ended: string
  absent: readonly number[]
  readBack: boolean
  score?: number | null
}

/** A whole number from 1 to 10, or null. */
export function readScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null
}

/** The round written when a session ends. */
export function endSession(end: SessionEnd): RoundValue {
  const round: RoundValue = {
    meeting: end.meeting,
    at: end.at,
    discussed: [],
    skipped: [],
    absent: [...new Set(end.absent)],
    not_discussed: [],
    kind: end.kind,
    started: end.started,
    ended: end.ended,
    read_back: end.readBack,
  }
  const score = readScore(end.score)
  if (score !== null) round.score = score
  return round
}

/** The round with its recap copied at `at`. */
export function withRecapSent(round: RoundValue, at: string): RoundValue {
  return { ...round, recap_sent: [...new Set([...(round.recap_sent ?? []), at])].sort() }
}

/** Undo of the copy. */
export function withoutRecapSent(round: RoundValue, at: string): RoundValue {
  const left = (round.recap_sent ?? []).filter((mark) => mark !== at)
  const next: RoundValue = { ...round }
  if (left.length) next.recap_sent = left
  else delete next.recap_sent
  return next
}

/** True when any verdict on the promise is still active (a helper for session views). */
export function hasActiveVerdict(ledger: ProLedger | null | undefined, taskId: number): boolean {
  return activeVerdicts(recordValue(ledger?.promises, taskId)).length > 0
}
