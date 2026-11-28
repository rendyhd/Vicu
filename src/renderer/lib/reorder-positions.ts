// Where a dragged task gets its position. Vikunja orders a list view by a float `position` per
// task. In the default order ("Due date, then manual") the list shows dated tasks first (by date)
// and then the undated ones by position (see task-sort.ts), so only undated positions mean anything
// and only they anchor a drop. In the manual order every row is in position order and every row
// anchors (`anchorsFor`, cross-app semantics 12.4).
//
// A drop normally sends one position, the middle between the undated neighbours. That fails when
// the neighbours share a position, which is common: every task moved into a project gets position
// 0 in its list view, and repeated drops in the same gap converge. The middle of two equal numbers
// is the same number, so the task stayed where it was and the drag looked like it did nothing
// (the Inbox reorder bug). When there is no room, the undated tasks are spread out again in their
// new order.

import { NULL_DATE } from './constants'
import type { Task } from './vikunja-types'
import { canReorderTask, orderAllowsReorder, parseTaskOrder } from '../../shared/task-order'
import { t } from '../../shared/i18n'
import { TASK_ORDER_LABEL_KEYS } from './task-order-labels'

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

/** Which rows give a drop its position: every row in the manual order, the undated ones otherwise. */
export type PositionAnchor = (task: Pick<Task, 'due_date'>) => boolean

export function anchorsFor(order: unknown): PositionAnchor {
  return order === 'manual' ? () => true : isUndatedTask
}

/**
 * The position for a task dropped at `targetIdx` of `tasks` (the list without the dragged task):
 * the middle between the nearest undated tasks above and below, half a step past the last one at
 * the end, half of the first at the top. `hasRoom` is false when the neighbours are equal or too
 * close for the middle to tell them apart.
 */
export function insertPosition(
  tasks: readonly Task[],
  targetIdx: number,
  anchors: PositionAnchor = isUndatedTask,
): { position: number; hasRoom: boolean } {
  let above = 0
  for (let i = Math.min(targetIdx - 1, tasks.length - 1); i >= 0; i--) {
    const candidate = tasks[i]
    if (candidate && anchors(candidate)) {
      above = candidate.position ?? 0
      break
    }
  }

  let below = above + POSITION_STEP
  for (let i = targetIdx; i < tasks.length; i++) {
    const candidate = tasks[i]
    if (candidate && anchors(candidate)) {
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
export function planMove(
  tasks: readonly Task[],
  oldIndex: number,
  newIndex: number,
  anchors: PositionAnchor = isUndatedTask,
): MovePlan {
  const moved = tasks[oldIndex]
  const without = tasks.filter((_, index) => index !== oldIndex)
  const insert = insertPosition(without, newIndex, anchors)
  if (insert.hasRoom) return { position: insert.position, renumbered: [] }

  const ordered = [...without.slice(0, newIndex), moved, ...without.slice(newIndex)]
  const renumbered: PositionUpdate[] = []
  let movedPosition = insert.position
  let next = POSITION_STEP
  for (const entry of ordered) {
    if (entry !== moved && !anchors(entry)) continue
    const position = next
    next += POSITION_STEP
    if (entry === moved) movedPosition = position
    else if (entry.position !== position) renumbered.push({ taskId: entry.id, position })
  }
  return { position: movedPosition, renumbered }
}

export type TaskStep = 'up' | 'down'

/**
 * Why a row cannot take a step: it is not in the list, the order sorts every row (Priority, Title
 * ...), the row has a due date in "Due date, then manual", or the row next to it cannot be passed
 * (the edge of the list, or a dated row above the first undated one).
 */
export type TaskStepBlock = 'not-listed' | 'sorted' | 'dated' | 'edge'

export type TaskStepPlan =
  | { ok: true; neighbour: Task; plan: MovePlan }
  | { ok: false; reason: TaskStepBlock }

/**
 * Move up and Move down (Alt+Shift+arrows, the row menu): the task at its place in `tasks` (the
 * list as displayed) trades places with the row above or below. Like a drag (cross-app semantics
 * 12.4) both rows must be ones the order lets move, so in "Due date, then manual" an undated row
 * never passes a dated one. The positions come from planMove, so equal neighbours are spread.
 */
export function planTaskStep(tasks: readonly Task[], taskId: number, step: TaskStep, order: unknown): TaskStepPlan {
  const index = tasks.findIndex((entry) => entry.id === taskId)
  if (index === -1) return { ok: false, reason: 'not-listed' }
  if (!orderAllowsReorder(order)) return { ok: false, reason: 'sorted' }
  if (!canReorderTask(order, tasks[index])) return { ok: false, reason: 'dated' }
  // In the list without the moved task the row below sits at `index`, so going after it is `index + 1`.
  const newIndex = step === 'up' ? index - 1 : index + 1
  const neighbour = tasks[newIndex]
  if (!neighbour || !canReorderTask(order, neighbour)) return { ok: false, reason: 'edge' }
  return { ok: true, neighbour, plan: planMove(tasks, index, newIndex, anchorsFor(order)) }
}

/** What is said when a step cannot be taken. */
export function taskStepRefusal(
  result: Extract<TaskStepPlan, { ok: false }>,
  title: string,
  step: TaskStep,
  order: unknown,
  /** The edge is a dated row (the first undated row in "Due date, then manual"), not the list's end. */
  datedEdge: boolean,
): { message: string; toast: boolean } | null {
  switch (result.reason) {
    case 'not-listed':
      return null
    case 'sorted':
      return {
        message: t('taskActions.sortedBy', { order: t(TASK_ORDER_LABEL_KEYS[parseTaskOrder(order)]) }),
        toast: true,
      }
    case 'dated':
      return { message: t('taskActions.datedOrder'), toast: true }
    case 'edge':
      return {
        message: datedEdge
          ? t('taskActions.alreadyFirstUndated', { title })
          : t(step === 'up' ? 'taskActions.alreadyFirst' : 'taskActions.alreadyLast', { title }),
        toast: false,
      }
  }
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
 * writes to one view well), the other items first and the dragged one last, and stops at the first
 * failure by letting `send` throw. A refetch afterwards shows what the server really holds.
 */
export async function sendPositionUpdates<U>(
  send: (update: U) => Promise<void>,
  moved: U,
  renumbered: readonly U[] = [],
): Promise<void> {
  for (const update of renumbered) await send(update)
  await send(moved)
}

export interface SiblingPositionUpdate {
  id: number
  position: number
}

export interface SiblingMovePlan {
  /** The new position of the dragged item. */
  position: number
  /** Other siblings that have to move too, when there was no room; empty otherwise. */
  renumbered: SiblingPositionUpdate[]
}

/**
 * The project counterpart of planMove, for sidebar projects and sections: siblings in display
 * order, the one at `oldIndex` dropped at `newIndex` (the index in the list without it). Equal or
 * very close neighbours happen (position 0 from imports and API clients, repeated drops into one
 * gap converging) and the middle between them is the same number, so the drag changed nothing.
 * With room only the dragged project changes; without, every sibling gets a fresh position one
 * step apart in the new order and only those whose position changes are listed.
 */
export function planSiblingMove(
  siblings: readonly { id: number; position: number }[],
  oldIndex: number,
  newIndex: number,
): SiblingMovePlan {
  const moved = siblings[oldIndex]
  const without = siblings.filter((_, index) => index !== oldIndex)
  const above = without[newIndex - 1]?.position ?? 0
  const below = without[newIndex]?.position ?? above + POSITION_STEP
  if (below - above >= MIN_POSITION_GAP) return { position: (above + below) / 2, renumbered: [] }

  const ordered = [...without.slice(0, newIndex), moved, ...without.slice(newIndex)]
  const renumbered: SiblingPositionUpdate[] = []
  let movedPosition = (above + below) / 2
  ordered.forEach((entry, index) => {
    const position = (index + 1) * POSITION_STEP
    if (entry === moved) movedPosition = position
    else if (entry.position !== position) renumbered.push({ id: entry.id, position })
  })
  return { position: movedPosition, renumbered }
}

/**
 * A section made between two others: it is created last, so when it belongs earlier this plans the
 * move from the end to `index` (null when it already is in place, or for an index at the end).
 */
export function planInsertedSibling(
  siblings: readonly { id: number; position: number }[],
  created: { id: number; position: number },
  index: number,
): SiblingMovePlan | null {
  if (index >= siblings.length) return null
  return planSiblingMove([...siblings, created], siblings.length, index)
}
