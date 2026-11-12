/**
 * Repeat rules (docs/cross-app-semantics-v1.md section 21.13): an end (a day or a number of times)
 * and catching up, beside Vikunja's own repeat. Completing stays `{ "done": true }`; at the end the
 * repeat is turned off first, so the server completes the task instead of moving it. Both apps run
 * the `pro.repeatRule` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { isNoDueDate, toLocalDate, type LocalDate } from '../due-dates'
import type { RepeatRule } from './prefs'

export interface RepeatTask {
  id: number
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  repeat_after?: number | null
  repeat_mode?: number | null
}

const instant = (value: string | null | undefined): Date | null => {
  if (isNoDueDate(value)) return null
  const parsed = new Date(value as string)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Whether Vikunja repeats the task: an interval, or monthly (mode 1). */
export function repeats(task: RepeatTask): boolean {
  return task.repeat_mode === 1 || (typeof task.repeat_after === 'number' && task.repeat_after > 0)
}

/** Vikunja's next due date after a completion at `now`: mode 0 adds the interval, 1 a month, 2 counts from now. */
export function nextDue(task: RepeatTask, now: Date): Date | null {
  const due = instant(task.due_date)
  if (task.repeat_mode === 2) {
    return typeof task.repeat_after === 'number' && task.repeat_after > 0 ? new Date(now.getTime() + task.repeat_after * 1000) : null
  }
  if (!due) return null
  if (task.repeat_mode === 1) return new Date(due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes(), due.getSeconds())
  if (typeof task.repeat_after === 'number' && task.repeat_after > 0) return new Date(due.getTime() + task.repeat_after * 1000)
  return null
}

export interface CompletionPlan {
  /** Merge patches to send, in order; the last is always `{ done: true }`. */
  patches: Array<Record<string, unknown>>
  /** The rule's new stored value: `undefined` unchanged, `null` removed. */
  rule: RepeatRule | null | undefined
  /** After the server answers, run `catchUpPatch` on the task it returns. */
  catchUp: boolean
}

/**
 * What completing a repeating task with a rule sends. The end is reached when this occurrence is the
 * last one (`count` 1) or the next due day is after `until`: the repeat goes off first, then the
 * completion, and the rule is removed. Otherwise the completion, the count lowered by one, and
 * catching up when the rule says so (not for mode 2, which already counts from the completion).
 */
export function completionPlan(task: RepeatTask, rule: RepeatRule | null | undefined, now: Date): CompletionPlan {
  const done = { done: true }
  if (!rule || !repeats(task)) return { patches: [done], rule: undefined, catchUp: false }
  const next = nextDue(task, now)
  const ends = rule.count === 1 || (rule.until !== undefined && next !== null && toLocalDate(next) > rule.until)
  if (ends) return { patches: [{ repeat_after: 0, repeat_mode: 0 }, done], rule: null, catchUp: false }
  const nextRule = rule.count !== undefined ? { ...rule, count: rule.count - 1 } : undefined
  return { patches: [done], rule: nextRule, catchUp: rule.catch_up === true && task.repeat_mode !== 2 }
}

/**
 * Catching up, after the server moved the task: while its due day is before today, move it by the
 * interval (mode 0) or a month (mode 1) again; the start and end move by the same amount. Null when
 * nothing moves. Stops at the rule's `until`: the patch is then null and the task stays as it is.
 */
export function catchUpPatch(task: RepeatTask, today: LocalDate, until?: string): Record<string, unknown> | null {
  const due = instant(task.due_date)
  if (!due || !repeats(task) || task.repeat_mode === 2) return null
  let moved = due
  let guard = 0
  while (toLocalDate(moved) < today && guard++ < 1000) {
    const next = nextDue({ ...task, due_date: moved.toISOString() }, moved)
    if (!next) return null
    moved = next
  }
  if (moved.getTime() === due.getTime()) return null
  if (until !== undefined && toLocalDate(moved) > until) return null
  const delta = moved.getTime() - due.getTime()
  const patch: Record<string, unknown> = { due_date: moved.toISOString() }
  const start = instant(task.start_date)
  const end = instant(task.end_date)
  if (start) patch.start_date = new Date(start.getTime() + delta).toISOString()
  if (end) patch.end_date = new Date(end.getTime() + delta).toISOString()
  return patch
}
