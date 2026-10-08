import { describe, expect, it } from 'vitest'
import { diffRows, MAX_EDIT, type RowBox } from '../list-motion'
import { staggerDelay } from '../motion'

const rows = (...ids: number[]) => new Map<number, RowBox>(ids.map((id, i) => [id, { top: i * 60, left: 0, height: 60 }]))

describe('diffRows', () => {
  it('animates nothing for the first population or an emptied list', () => {
    expect(diffRows(new Map(), rows(1, 2, 3))).toEqual({ added: [], removed: [], moved: [] })
    expect(diffRows(rows(1, 2), new Map())).toEqual({ added: [], removed: [], moved: [] })
  })

  it('reports a new row and a removed row, and shifts nothing else', () => {
    expect(diffRows(rows(1, 2, 3), rows(1, 4, 2, 3))).toEqual({ added: [4], removed: [], moved: [] })
    expect(diffRows(rows(1, 2, 3), rows(1, 3))).toEqual({ added: [], removed: [2], moved: [] })
  })

  it('treats a replaced list as no animation (no row kept, or more than MAX_EDIT edits)', () => {
    expect(diffRows(rows(1, 2, 3), rows(7, 8, 9))).toEqual({ added: [], removed: [], moved: [] })
    const many = Array.from({ length: MAX_EDIT + 1 }, (_, i) => 100 + i)
    expect(diffRows(rows(1, 2), rows(1, 2, ...many))).toEqual({ added: [], removed: [], moved: [] })
  })

  it('moves the rows of a reorder back to where they were, in list order', () => {
    // 1 2 3 4 becomes 2 3 1 4: the first row went two places down.
    const diff = diffRows(rows(1, 2, 3, 4), rows(2, 3, 1, 4))
    expect(diff.moved).toEqual([
      { id: 2, dx: 0, dy: 60 },
      { id: 3, dx: 0, dy: 60 },
      { id: 1, dx: 0, dy: -120 },
    ])
  })

  it('continues an interrupted move from where the row was drawn', () => {
    const diff = diffRows(rows(1, 2), rows(2, 1), new Map([[1, { x: 0, y: 20 }]]))
    expect(diff.moved).toContainEqual({ id: 1, dx: 0, dy: -40 })
  })

  it('leaves out rows that did not move and rows whose element was replaced', () => {
    expect(diffRows(rows(1, 2, 3), rows(1, 2, 3)).moved).toEqual([])
    const taller = new Map<number, RowBox>([[1, { top: 0, left: 0, height: 60 }], [2, { top: 160, left: 0, height: 60 }]])
    const diff = diffRows(rows(1, 2), taller, new Map(), new Set([1]))
    expect(diff.moved).toEqual([{ id: 2, dx: 0, dy: -100 }])
  })
})

describe('staggerDelay', () => {
  it('steps the delay by the token and stops after the maximum', () => {
    expect([0, 1, 2, 5, 9].map((i) => staggerDelay(i, 35, 5))).toEqual([0, 35, 70, 175, 175])
    expect(staggerDelay(-1, 35, 5)).toBe(0)
  })
})
