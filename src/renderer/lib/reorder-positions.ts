// Where a dragged task gets its position. Vikunja orders a list view by a float `position` per
// task; the list shows dated tasks first (by date) and then the undated ones by position (see
// task-sort.ts), so only undated positions mean anything and only they anchor a drop.
//
// A drop normally sends one position, the middle between the undated neighbours. That fails when
// the neighbours share a position, which is common: every task moved into a project gets position
// 0 in its list view, and repeated drops in the same gap converge. The middle of two equal numbers
// is the same number, so the task stayed where it was and the drag looked like it did nothing
// (the Inbox reorder bug). When there is no room, the undated tasks are spread out again in their
// new order.

import { NULL_DATE } from './constants'
import type { Task } from './vikunja-types'

/** The distance Vikunja keeps between neighbouring positions. */
export const POSITION_STEP = 2 ** 16
/** Neighbours closer than this have no room for another task between them. */
export const MIN_POSITION_GAP = 1

export interface PositionUpdate {
  taskId: number
  position: number
}

export function isUndatedTask(task: Pick<Task, 'due_date'>): boolean {
  return !task.due_date || task.due_date === NULL_DATE
}

/**
 * The position for a task dropped at `targetIdx` of `tasks` (the list without the dragged task):
 * the middle between the nearest undated tasks above and below, half a step past the last one at
 * the end, half of the first at the top. `hasRoom` is false when the neighbours are equal or too
 * close for the middle to tell them apart.
 */
export function insertPosition(tasks: readonly Task[], targetIdx: number): { position: number; hasRoom: boolean } {
  let above = 0
  for (let i = Math.min(targetIdx - 1, tasks.length - 1); i >= 0; i--) {
    const candidate = tasks[i]
    if (candidate && isUndatedTask(candidate)) {
      above = candidate.position ?? 0
      break
    }
  }

  let below = above + POSITION_STEP
  for (let i = targetIdx; i < tasks.length; i++) {
    const candidate = tasks[i]
    if (candidate && isUndatedTask(candidate)) {
      below = candidate.position ?? above + POSITION_STEP
      break
    }
  }

  return { position: (above + below) / 2, hasRoom: below - above >= MIN_POSITION_GAP }
}

export interface MovePlan {
  /** The new position of the dragged task. */
  position: number
  /** Other tasks that have to move too, when there was no room; empty otherwise. */
  renumbered: PositionUpdate[]
}

/**
 * What to send when the task at `oldIndex` is dropped at `newIndex` (the index in the list
 * without it, like dnd-kit's `arrayMove`). With room, only the dragged task changes. Without,
 * every undated task gets a fresh position in the new order, one step apart, and only the ones
 * whose position actually changes are listed.
 */
export function planMove(tasks: readonly Task[], oldIndex: number, newIndex: number): MovePlan {
  const moved = tasks[oldIndex]
  const without = tasks.filter((_, index) => index !== oldIndex)
  const insert = insertPosition(without, newIndex)
  if (insert.hasRoom) return { position: insert.position, renumbered: [] }

  const ordered = [...without.slice(0, newIndex), moved, ...without.slice(newIndex)]
  const renumbered: PositionUpdate[] = []
  let movedPosition = insert.position
  let next = POSITION_STEP
  for (const entry of ordered) {
    if (entry !== moved && !isUndatedTask(entry)) continue
    const position = next
    next += POSITION_STEP
    if (entry === moved) movedPosition = position
    else if (entry.position !== position) renumbered.push({ taskId: entry.id, position })
  }
  return { position: movedPosition, renumbered }
}

/** The tasks with the given positions applied (a copy; tasks that are not listed are returned as they are). */
export function applyPositionUpdates<T extends { id: number; position: number }>(
  tasks: readonly T[],
  updates: readonly PositionUpdate[],
): T[] {
  const positions = new Map(updates.map((update) => [update.taskId, update.position]))
  return tasks.map((entry) => (positions.has(entry.id) ? { ...entry, position: positions.get(entry.id)! } : entry))
}

/**
 * Sends the positions of a move one request after the other (the server does not take parallel
 * writes to one view well), the other tasks first and the dragged task last, and stops at the first
 * failure by letting `send` throw. A refetch afterwards shows what the server really holds.
 */
export async function sendPositionUpdates(
  send: (update: PositionUpdate) => Promise<void>,
  moved: PositionUpdate,
  renumbered: readonly PositionUpdate[] = [],
): Promise<void> {
  for (const update of renumbered) await send(update)
  await send(moved)
}
