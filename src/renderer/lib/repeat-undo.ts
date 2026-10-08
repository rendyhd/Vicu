import { taskPatch, type TaskPatch } from '@/lib/merge-patches'
import type { Task } from '@/lib/vikunja-types'

/**
 * Undo of a completed repeating task. Completing one does not finish it: the server moves its due,
 * start and end dates and its reminders to the next occurrence and sends the task back open. The
 * Undo of that completion used to send `{ done: false }` to a task that was already open, so
 * nothing came back. Like Android, the dates and reminders as they were before the completion are
 * remembered when the answer shows they moved, and Undo restores them with a merge patch, unless
 * the user edited them since.
 */

type Fields = Pick<Task, 'due_date' | 'start_date' | 'end_date' | 'reminders'>

export interface RepeatSnapshot {
  /** The dates and reminders before the completion. */
  before: Fields
  /** What the server moved them to; if the task still has these, nobody edited them since. */
  after: Fields
}

const snapshots = new Map<number, RepeatSnapshot>()

const fieldsOf = (task: Task): Fields => ({
  due_date: task.due_date,
  start_date: task.start_date,
  end_date: task.end_date,
  reminders: task.reminders ?? [],
})

/**
 * Called with the task as it was before it was completed and the server's answer. Remembers the task
 * when the answer is open again with other dates or reminders (a repeating task that advanced).
 */
export function rememberRepeatCompletion(before: Task, answer: Task | null | undefined): void {
  if (!answer || answer.done !== false) return
  const moved = taskPatch(fieldsOf(before), fieldsOf(answer))
  if (Object.keys(moved).length === 0) return
  snapshots.set(before.id, { before: fieldsOf(before), after: fieldsOf(answer) })
}

/** The remembered state of a task and forget it (an Undo uses it once). */
export function takeRepeatSnapshot(taskId: number): RepeatSnapshot | null {
  const snapshot = snapshots.get(taskId) ?? null
  snapshots.delete(taskId)
  return snapshot
}

/** Tests: forget everything. */
export function clearRepeatSnapshots(): void {
  snapshots.clear()
}

/**
 * The patch that undoes a completion, given the task as it is on the server now.
 *
 * - Dates and reminders go back to `before` when they still are what the completion left (`after`);
 *   a field the user changed since is left alone, and so are the others then: the task counts as edited.
 * - `done: false` is added when the task is not open.
 * Returns an empty patch when there is nothing to send.
 */
export function repeatUndoPatch(snapshot: RepeatSnapshot, current: Task): TaskPatch {
  const edited = Object.keys(taskPatch(snapshot.after, fieldsOf(current))).length > 0
  const restore = edited ? {} : taskPatch(fieldsOf(current), snapshot.before)
  return current.done ? { ...restore, done: false } : restore
}
