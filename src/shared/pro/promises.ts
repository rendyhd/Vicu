/**
 * Promises (docs/cross-app-semantics-v1.md section 21.6): a task someone promised you (`theirs`) or
 * you owe someone (`mine`), with its details in the ledger. No stages: a promise is promised, then it
 * gets a verdict. Both apps run the `pro.promises`, `pro.misses` and `pro.waitingOn` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { addLocalDays, dateOnlyDue, isNoDueDate, localDateOf, type LocalDate } from '../due-dates'
import {
  activeVerdicts,
  finalVerdictOf,
  recordValue,
  type PromiseValue,
  type ProLedger,
  type Verdict,
  type VerdictKind,
} from './ledger'

export interface PromiseTask {
  id: number
  title?: string
  done?: boolean
  done_at?: string | null
  due_date?: string | null
  labels?: ReadonlyArray<{ id: number }> | null
}

export function promiseOf(ledger: ProLedger | null | undefined, taskId: number): PromiseValue | null {
  return recordValue(ledger?.promises, taskId)
}

/** Misses: active `not_yet` verdicts. Counted, never stored, so an Undo counts right. */
export function missesOf(promise: PromiseValue | null | undefined): number {
  return activeVerdicts(promise).filter((verdict) => verdict.kind === 'not_yet').length
}

/**
 * The day the promise is due now: the last active verdict's new date; a `not_yet` without one asks
 * again the day after it was given; otherwise the task's due date. Null when there is none.
 */
export function effectiveDue(task: PromiseTask, promise: PromiseValue | null | undefined): LocalDate | null {
  const verdicts = activeVerdicts(promise)
  const last = verdicts[verdicts.length - 1]
  if (last && (last.kind === 'not_yet' || last.kind === 'renegotiated')) {
    if (typeof last.new_due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(last.new_due)) return last.new_due
    if (last.kind === 'not_yet') return addLocalDays(localDateOf(last.at), 1)
  }
  return isNoDueDate(task.due_date) ? null : localDateOf(task.due_date)
}

/** "Ask me tomorrow", once per due day: `pro_verdict_snooze` on the device. */
export interface VerdictSnooze {
  /** The effective due day the snooze was used for. */
  due: LocalDate
  /** Asked again from this day. */
  until: LocalDate
}

export function readVerdictSnoozes(value: unknown): Record<string, VerdictSnooze> {
  const snoozes: Record<string, VerdictSnooze> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return snoozes
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const snooze = entry as Partial<VerdictSnooze> | null
    if (snooze && typeof snooze.due === 'string' && typeof snooze.until === 'string') snoozes[id] = { due: snooze.due, until: snooze.until }
  }
  return snoozes
}

/**
 * Decision 10: a `theirs` promise whose effective due day has come must get a verdict, unless it
 * was snoozed for that day. Open tasks only; a done task is "completed elsewhere" instead.
 */
export function needsVerdict(
  task: PromiseTask,
  promise: PromiseValue | null | undefined,
  today: LocalDate,
  snooze?: VerdictSnooze | null,
): boolean {
  if (!promise || promise.dir !== 'theirs' || task.done) return false
  if (finalVerdictOf(promise)) return false
  const due = effectiveDue(task, promise)
  if (due === null || due > today) return false
  if (snooze && snooze.due === due && today < snooze.until) return false
  return true
}

/** "Ask me tomorrow" is offered once per due day. */
export function canSnooze(task: PromiseTask, promise: PromiseValue | null | undefined, snooze?: VerdictSnooze | null): boolean {
  const due = effectiveDue(task, promise)
  return due !== null && (!snooze || snooze.due !== due)
}

export function snoozeFor(task: PromiseTask, promise: PromiseValue | null | undefined, today: LocalDate): VerdictSnooze | null {
  const due = effectiveDue(task, promise)
  return due === null ? null : { due, until: addLocalDays(today, 1) }
}

/**
 * Decision 11 and section 21.6: a `theirs` promise whose task was completed (here, elsewhere or in
 * the web app) without a final verdict is asked about once: "Delivered by Jan, or did you do it?"
 */
export function completedElsewhere(task: PromiseTask, promise: PromiseValue | null | undefined): boolean {
  return !!promise && promise.dir === 'theirs' && task.done === true && !finalVerdictOf(promise)
}

export interface VerdictChange {
  verdict: Verdict
  /** The merge patch for the task, or null when the task does not change. */
  taskPatch: Record<string, unknown> | null
}

/**
 * A verdict and what it writes to the task: a final verdict completes it (`{ done: true }` only, so
 * Vikunja's repeat still works); a new date moves the due date (date-only, the 16.3 rules apply as
 * for any due change). `taken_over` ("I did it") and an answer about a completed task change nothing.
 */
export function buildVerdict(
  task: PromiseTask,
  kind: VerdictKind,
  options: { id: string; at: string; newDue?: LocalDate | null; blocker?: string | null },
): VerdictChange {
  const verdict: Verdict = { id: options.id, at: options.at, kind }
  if ((kind === 'not_yet' || kind === 'renegotiated') && options.newDue) verdict.new_due = options.newDue
  if (kind === 'not_yet' && options.blocker && options.blocker.trim()) verdict.blocker = options.blocker.trim()
  let taskPatch: Record<string, unknown> | null = null
  if (!task.done && (kind === 'delivered' || kind === 'late' || kind === 'dropped' || kind === 'taken_over')) {
    taskPatch = { done: true }
  } else if (!task.done && verdict.new_due) {
    const due = dateOnlyDue(verdict.new_due)
    if (isNoDueDate(task.due_date) || new Date(task.due_date as string).getTime() !== new Date(due).getTime()) {
      taskPatch = { due_date: due }
    }
  }
  return { verdict, taskPatch }
}

/** The promise with one more verdict. */
export function withVerdict(promise: PromiseValue, verdict: Verdict): PromiseValue {
  return { ...promise, verdicts: [...(promise.verdicts ?? []), verdict] }
}

/** Undo: the verdict stays, marked undone, so a merge cannot bring it back. */
export function withVerdictUndone(promise: PromiseValue, verdictId: string): PromiseValue {
  return {
    ...promise,
    verdicts: (promise.verdicts ?? []).map((verdict) => (verdict.id === verdictId ? { ...verdict, undone: true } : verdict)),
  }
}

/** Decision 7: the promise marked as sent in a recap at `at`. */
export function withSent(promise: PromiseValue, at: string): PromiseValue {
  return { ...promise, sent: [...new Set([...(promise.sent ?? []), at])].sort() }
}

export function isSent(promise: PromiseValue | null | undefined): boolean {
  return (promise?.sent?.length ?? 0) > 0
}

// --- Waiting on (section 21.6) ------------------------------------------------------------------

export interface WaitingGroup {
  /** The person's label id; null for tasks without one. */
  person: number | null
  tasks: number[]
}

/**
 * Waiting on: open `theirs` promises and open tasks with an on-hold label, grouped by person (the
 * promise's person, else the first person label on the task, else none), groups by their earliest
 * effective due day (none last), then person id, the group without a person last; tasks by effective
 * due day (none last), then id.
 */
export function waitingOn(
  tasks: readonly PromiseTask[],
  ledger: ProLedger | null | undefined,
  isOnHoldLabel: (labelId: number) => boolean,
  isPerson: (labelId: number) => boolean,
): WaitingGroup[] {
  const rows: Array<{ id: number; person: number | null; due: LocalDate | null }> = []
  for (const task of tasks) {
    if (task.done) continue
    const promise = promiseOf(ledger, task.id)
    const theirs = promise?.dir === 'theirs' && !finalVerdictOf(promise)
    const held = (task.labels ?? []).some((label) => isOnHoldLabel(label.id))
    if (!theirs && !held) continue
    const person = (theirs ? promise!.person : null) ?? (task.labels ?? []).find((label) => isPerson(label.id))?.id ?? null
    rows.push({ id: task.id, person, due: theirs ? effectiveDue(task, promise) : (isNoDueDate(task.due_date) ? null : localDateOf(task.due_date)) })
  }
  const byDue = (a: { due: LocalDate | null; id: number }, b: { due: LocalDate | null; id: number }) =>
    a.due === b.due ? a.id - b.id : a.due === null ? 1 : b.due === null ? -1 : a.due < b.due ? -1 : 1
  const groups = new Map<number | null, typeof rows>()
  for (const row of rows) groups.set(row.person, [...(groups.get(row.person) ?? []), row])
  const result = [...groups.entries()].map(([person, list]) => {
    const sorted = [...list].sort(byDue)
    return { person, tasks: sorted.map((row) => row.id), first: sorted[0].due }
  })
  result.sort((a, b) => {
    if (a.person === null || b.person === null) return a.person === null ? (b.person === null ? 0 : 1) : -1
    if (a.first !== b.first) return a.first === null ? 1 : b.first === null ? -1 : a.first < b.first ? -1 : 1
    return a.person - b.person
  })
  return result.map(({ person, tasks: ids }) => ({ person, tasks: ids }))
}

/** Open promises with no "sent" mark (the weekly reminder, decision 7). */
export function unsentPromises(tasks: readonly PromiseTask[], ledger: ProLedger | null | undefined): number[] {
  return tasks
    .filter((task) => {
      if (task.done) return false
      const promise = promiseOf(ledger, task.id)
      return !!promise && !finalVerdictOf(promise) && !isSent(promise)
    })
    .map((task) => task.id)
    .sort((a, b) => a - b)
}

/** The confirm task of decision 31: "Confirm with Jan: <what>". */
export function confirmTitle(personName: string, what: string): string {
  return `Confirm with ${personName.trim()}: ${what.trim()}`
}

/** The person name and the promise of a confirm task's title, or null when it is not one. */
export function readConfirmTitle(title: string): { name: string; what: string } | null {
  const match = /^Confirm with ([^:]+):\s*(.+)$/.exec(title.trim())
  return match ? { name: match[1].trim(), what: match[2].trim() } : null
}
