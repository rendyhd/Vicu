// A repeating task completed on two devices (docs/cross-app-semantics-v1.md section 7.5, vectors
// `repeatCompletion` in test-fixtures/cross-app-semantics-v1.json).
//
// Vikunja moves a repeating task on from the dates it holds when `{ done: true }` arrives. A second
// completion of the same occurrence, sent later by a device that was offline or showed an old copy,
// would move it on again and skip an occurrence. So a completion remembers the due date it completed
// (`completedDue`), and before it is sent the app reads the task and decides: send or skip.
//
// Import-free, so every tsconfig can include it. Android has the same rule from the same vectors.

/** What to do with the completion of a task the app holds as repeating. */
export type RepeatCompletionDecision = 'send' | 'skip'

/** The fields of a task the rule looks at. */
export interface RepeatCompletionTask {
  done?: unknown
  due_date?: unknown
  repeat_after?: unknown
  repeat_mode?: unknown
}

const ZERO_DATE_PREFIX = '0001-01-01'

/** Whether a task repeats: `repeat_after` above 0, or `repeat_mode` not 0. */
export function isRepeatingTask(task: RepeatCompletionTask | null | undefined): boolean {
  if (!task) return false
  const after = typeof task.repeat_after === 'number' ? task.repeat_after : 0
  const mode = typeof task.repeat_mode === 'number' ? task.repeat_mode : 0
  return after > 0 || mode !== 0
}

/**
 * A due date as an instant (milliseconds), or null for no date. `null`, an empty string, the Go zero
 * time `0001-01-01T00:00:00Z` and anything that does not read as a date are all "no date".
 */
export function dueInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.startsWith(ZERO_DATE_PREFIX)) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/** Whether two due dates are the same instant (no date on both sides is the same). */
export function sameDue(a: unknown, b: unknown): boolean {
  return dueInstant(a) === dueInstant(b)
}

/**
 * Whether the completion of a repeating task is still sent, given the due date the app held when the
 * user completed it and the task as just read from the server:
 * - the server's task is done: skip;
 * - it does not repeat any more: send;
 * - its due date is the same instant as the completed due: send;
 * - otherwise another device completed this occurrence already: skip.
 */
export function decideRepeatCompletion(completedDue: unknown, server: RepeatCompletionTask): RepeatCompletionDecision {
  if (server.done === true) return 'skip'
  if (!isRepeatingTask(server)) return 'send'
  return sameDue(completedDue, server.due_date) ? 'send' : 'skip'
}

/** The due date to remember with a completion: the app's copy of the task, or undefined when it does not repeat (no check). */
export function completedDueFor(task: RepeatCompletionTask | null | undefined): string | null | undefined {
  if (!isRepeatingTask(task)) return undefined
  const due = task?.due_date
  return typeof due === 'string' ? due : null
}
