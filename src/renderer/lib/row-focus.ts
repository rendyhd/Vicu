/**
 * Where keyboard focus goes when rows leave the list (a bulk delete): the first remaining row after
 * the last removed one, else the last remaining row before it, else null (the list itself).
 * `orderedIds` is the rows' order on screen.
 */
export function nextRowAfterRemoval(orderedIds: readonly number[], removed: ReadonlySet<number>): number | null {
  let lastRemoved = -1
  orderedIds.forEach((id, index) => {
    if (removed.has(id)) lastRemoved = index
  })
  for (let i = lastRemoved + 1; i < orderedIds.length; i++) {
    if (!removed.has(orderedIds[i])) return orderedIds[i]
  }
  for (let i = Math.min(lastRemoved, orderedIds.length) - 1; i >= 0; i--) {
    if (!removed.has(orderedIds[i])) return orderedIds[i]
  }
  return null
}

/** The ids of the task rows in the document, in order, each once (nested rows included). */
export function visibleRowIds(root: ParentNode = document): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  root.querySelectorAll<HTMLElement>('[data-task-id]').forEach((el) => {
    const id = Number(el.getAttribute('data-task-id'))
    if (Number.isInteger(id) && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  })
  return ids
}
