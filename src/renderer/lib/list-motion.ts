// What changed in a list of task rows between two layouts (card 4.8), as plain data so the rules can
// be tested: which rows are new, which are gone, and how far each persisting row has to travel back
// to look as if it had not moved (FLIP). The DOM side is hooks/use-list-motion.ts.

export interface RowBox {
  /** Position inside the scrolled list, so scrolling does not look like a move. */
  top: number
  left: number
  height: number
}

export interface ListDiff {
  added: number[]
  removed: number[]
  /** Persisting rows that moved, in list order, with the shift that puts each back where it was (px). */
  moved: { id: number; dx: number; dy: number }[]
}

/** More added or removed rows than this in one change is a different list, not an edit of this one. */
export const MAX_EDIT = 3

/** Smaller shifts (px) are not animated. */
const MIN_SHIFT = 0.5

/**
 * `inflight` is the translation a row still shows from an earlier animation (its rendered position
 * minus its layout position); the row starts from there, so an interrupted move continues instead
 * of jumping. `restructured` lists rows whose element was replaced (a row became its card): the
 * view transition of card 4.4 moves those, so they are not shifted here.
 *
 * - First population, or a change that keeps no row or adds or removes more than MAX_EDIT: nothing
 *   is animated (a view changed, a list was loaded).
 * - Added or removed rows: those rows open and close, and the rows around them follow because their
 *   height changes; nothing else is shifted.
 * - Otherwise rows that moved are shifted back and play to their place.
 */
export function diffRows(
  previous: ReadonlyMap<number, RowBox>,
  next: ReadonlyMap<number, RowBox>,
  inflight: ReadonlyMap<number, { x: number; y: number }> = new Map(),
  restructured: ReadonlySet<number> = new Set(),
): ListDiff {
  const none: ListDiff = { added: [], removed: [], moved: [] }
  if (previous.size === 0 || next.size === 0) return none
  const added = [...next.keys()].filter((id) => !previous.has(id))
  const removed = [...previous.keys()].filter((id) => !next.has(id))
  const kept = next.size - added.length
  if (kept === 0 || added.length + removed.length > MAX_EDIT) return none
  if (added.length + removed.length > 0) return { added, removed, moved: [] }

  const moved: ListDiff['moved'] = []
  const ordered = [...next.entries()].sort((a, b) => a[1].top - b[1].top)
  for (const [id, box] of ordered) {
    const before = previous.get(id)
    if (!before || restructured.has(id)) continue
    const carry = inflight.get(id) ?? { x: 0, y: 0 }
    const dx = before.left + carry.x - box.left
    const dy = before.top + carry.y - box.top
    if (Math.abs(dx) >= MIN_SHIFT || Math.abs(dy) >= MIN_SHIFT) moved.push({ id, dx, dy })
  }
  return { added: [], removed: [], moved }
}
