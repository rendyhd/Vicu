import { describe, expect, it } from 'vitest'
import {
  applyPlacement,
  canMoveUnder,
  childrenOf,
  dropZone,
  effectiveParent,
  keyboardPlacement,
  placeAt,
  placeRelative,
  undoPlacement,
  TOP_LEVEL,
  type MovableProject,
} from '../project-moves'
import { POSITION_STEP } from '../reorder-positions'

const S = POSITION_STEP

// Inbox (hidden in the sidebar, still a top-level sibling)
// Work
//   Website redesign
//   Q4 planning
// Personal
//   Home renovation
//   Trip to Lisbon
const tree: MovableProject[] = [
  { id: 1, parent_project_id: 0, position: 1 * S },
  { id: 2, parent_project_id: 0, position: 2 * S },
  { id: 3, parent_project_id: 2, position: 1 * S },
  { id: 4, parent_project_id: 2, position: 2 * S },
  { id: 5, parent_project_id: 0, position: 3 * S },
  { id: 6, parent_project_id: 5, position: 1 * S },
  { id: 7, parent_project_id: 5, position: 2 * S },
]

const ids = (list: MovableProject[]) => list.map((p) => p.id)
const order = (projects: MovableProject[], parentId: number) => ids(childrenOf(projects, parentId))

function moved(projects: MovableProject[], id: number, placement: ReturnType<typeof placeAt>) {
  expect(placement).not.toBeNull()
  return applyPlacement(projects, id, placement!)
}

describe('project tree helpers', () => {
  it('lists children in position order and treats a missing parent as the top level', () => {
    expect(order(tree, TOP_LEVEL)).toEqual([1, 2, 5])
    expect(order(tree, 2)).toEqual([3, 4])
    const orphan = { id: 9, parent_project_id: 99, position: 10 * S }
    expect(effectiveParent(orphan, [...tree, orphan])).toBe(TOP_LEVEL)
    expect(order([...tree, orphan], TOP_LEVEL)).toEqual([1, 2, 5, 9])
  })

  it('never puts a project under itself or one of its own projects', () => {
    expect(canMoveUnder(2, 2, tree)).toBe(false)
    expect(canMoveUnder(2, 3, tree)).toBe(false)
    expect(canMoveUnder(2, 5, tree)).toBe(true)
    expect(canMoveUnder(3, TOP_LEVEL, tree)).toBe(true)
  })
})

describe('placeAt', () => {
  it('reorders among the same siblings without changing the parent', () => {
    const placement = placeAt(tree, 4, 2, 0)
    expect(placement).toMatchObject({ parentId: 2, parentChanged: false, renumbered: [] })
    expect(placement!.position).toBeLessThan(S)
    expect(order(moved(tree, 4, placement), 2)).toEqual([4, 3])
  })

  it('changes nothing when the project is already there', () => {
    expect(placeAt(tree, 3, 2, 0)).toBeNull()
  })

  it('moves to another parent at the given index', () => {
    const placement = placeAt(tree, 7, 2, 1)
    expect(placement).toMatchObject({ parentId: 2, parentChanged: true })
    const after = moved(tree, 7, placement)
    expect(order(after, 2)).toEqual([3, 7, 4])
    expect(order(after, 5)).toEqual([6])
  })

  it('spreads the new siblings out when two of them share a position', () => {
    const crowded: MovableProject[] = [
      { id: 1, parent_project_id: 0, position: 0 },
      { id: 2, parent_project_id: 0, position: 0 },
      { id: 3, parent_project_id: 9, position: 5 },
      { id: 9, parent_project_id: 0, position: 3 * S },
    ]
    const placement = placeAt(crowded, 3, TOP_LEVEL, 1)
    expect(placement!.renumbered.length).toBeGreaterThan(0)
    expect(order(moved(crowded, 3, placement), TOP_LEVEL)).toEqual([1, 3, 2, 9])
  })

  it('refuses a parent below the project', () => {
    expect(placeAt(tree, 2, 3, 0)).toBeNull()
  })
})

describe('placeRelative', () => {
  it('drops before and after a row at that row\'s level, the hidden Inbox included', () => {
    const before = moved(tree, 6, placeRelative(tree, 6, 2, 'before'))
    expect(order(before, TOP_LEVEL)).toEqual([1, 6, 2, 5])
    const after = moved(tree, 3, placeRelative(tree, 3, 5, 'after'))
    expect(order(after, TOP_LEVEL)).toEqual([1, 2, 5, 3])
  })

  it('drops into a row as its last child', () => {
    const into = moved(tree, 7, placeRelative(tree, 7, 2, 'into'))
    expect(order(into, 2)).toEqual([3, 4, 7])
    const leaf = moved(tree, 6, placeRelative(tree, 6, 3, 'into'))
    expect(order(leaf, 3)).toEqual([6])
  })

  it('ignores drops on the project itself or into its own projects', () => {
    expect(placeRelative(tree, 2, 2, 'into')).toBeNull()
    expect(placeRelative(tree, 2, 3, 'into')).toBeNull()
    expect(placeRelative(tree, 2, 4, 'after')).toBeNull()
  })

  it('treats a drop that keeps the order as no move', () => {
    expect(placeRelative(tree, 3, 4, 'before')).toBeNull()
    expect(placeRelative(tree, 4, 3, 'after')).toBeNull()
  })
})

describe('keyboardPlacement', () => {
  it('moves up and down among siblings and stops at the edges', () => {
    expect(order(moved(tree, 4, keyboardPlacement(tree, 4, 'up')), 2)).toEqual([4, 3])
    expect(order(moved(tree, 3, keyboardPlacement(tree, 3, 'down')), 2)).toEqual([4, 3])
    expect(keyboardPlacement(tree, 3, 'up')).toBeNull()
    expect(keyboardPlacement(tree, 4, 'down')).toBeNull()
  })

  it('nests under the sibling above and moves out after the parent', () => {
    expect(order(moved(tree, 4, keyboardPlacement(tree, 4, 'in')), 3)).toEqual([4])
    expect(keyboardPlacement(tree, 3, 'in')).toBeNull()
    const out = moved(tree, 3, keyboardPlacement(tree, 3, 'out'))
    expect(order(out, TOP_LEVEL)).toEqual([1, 2, 3, 5])
    expect(keyboardPlacement(tree, 2, 'out')).toBeNull()
  })

  it('passes over the hidden Inbox and never nests into it', () => {
    const inbox = new Set([1])
    expect(keyboardPlacement(tree, 2, 'up', inbox)).toBeNull()
    expect(keyboardPlacement(tree, 2, 'in', inbox)).toBeNull()
    expect(order(moved(tree, 5, keyboardPlacement(tree, 5, 'up', inbox)), TOP_LEVEL)).toEqual([1, 5, 2])
  })
})

describe('undoPlacement', () => {
  it('puts a moved project back before the sibling that followed it', () => {
    const after = moved(tree, 3, placeRelative(tree, 3, 5, 'into'))
    const back = moved(after, 3, undoPlacement(tree, after, 3))
    expect(order(back, 2)).toEqual([3, 4])
    expect(order(back, 5)).toEqual([6, 7])
  })

  it('returns a project shown at the top level to its archived parent', () => {
    // 8 lives under an archived project (not in the active list), so it shows at the top level.
    const withOrphan = [...tree, { id: 8, parent_project_id: 42, position: 4 * S }]
    const placement = placeRelative(withOrphan, 8, 2, 'into')
    const after = applyPlacement(withOrphan, 8, placement!)
    const undo = undoPlacement(withOrphan, after, 8)
    expect(undo).toMatchObject({ parentId: 42, parentChanged: true })
  })

  it('keeps the parent of a top-level reorder whose real parent is archived', () => {
    const withOrphan = [...tree, { id: 8, parent_project_id: 42, position: 4 * S }]
    const placement = placeRelative(withOrphan, 8, 1, 'before')
    expect(placement).toMatchObject({ parentId: TOP_LEVEL, parentChanged: false })
    const after = applyPlacement(withOrphan, 8, placement!)
    expect(after.find((p) => p.id === 8)!.parent_project_id).toBe(42)
  })
})

describe('dropZone', () => {
  const rect = { top: 100, height: 30 }
  it('splits a row into before, into and after', () => {
    expect(dropZone(102, rect, false)).toBe('before')
    expect(dropZone(115, rect, false)).toBe('into')
    expect(dropZone(128, rect, false)).toBe('after')
  })

  it('has no after on a parent whose children are shown', () => {
    expect(dropZone(128, rect, true)).toBe('into')
    expect(dropZone(101, rect, true)).toBe('before')
  })
})
