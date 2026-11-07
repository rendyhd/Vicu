/**
 * The order a person dragged a task's subtasks into (docs/cross-app-semantics-v1.md section 19), a
 * synced preference of the account: `subtask_order.<taskId>` holds subtask ids. Android has the same
 * rules (`SubtaskOrder`); both run the `subtaskOrder` vectors of the contract fixture.
 *
 * This file stays free of imports so any tsconfig can include it.
 */
export function subtaskOrderKey(taskId: number): string {
  return `subtask_order.${taskId}`
}

/** The ids `value` holds; anything else acts as no order. */
export function readSubtaskOrder(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((id): id is number => typeof id === 'number') : []
}

/** Ids listed first, in the listed order; the others follow as they came. */
export function sortSubtasks<T extends { id: number }>(items: readonly T[], order: readonly number[]): T[] {
  if (order.length === 0) return [...items]
  const place = new Map(order.map((id, index) => [id, index]))
  const rank = (item: T) => place.get(item.id) ?? Number.MAX_SAFE_INTEGER
  return [...items].sort((a, b) => rank(a) - rank(b))
}

/** `ids` with `id` moved `delta` places, or null when it cannot go there. */
export function movedId(ids: readonly number[], id: number, delta: number): number[] | null {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
