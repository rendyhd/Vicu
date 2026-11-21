import { describe, expect, it } from 'vitest'
import { categoryHeaderListed, pruneToListed } from '../work-sidebar'

interface Node {
  id: number
  children: Node[]
}
const tree: Node = { id: 1, children: [{ id: 2, children: [{ id: 3, children: [] }] }, { id: 4, children: [] }] }

describe('pruneToListed', () => {
  it('keeps the node as it is when nothing is narrowed', () => {
    expect(pruneToListed(tree, null)).toEqual([tree])
  })

  it('cuts what is not listed, with its subtree', () => {
    expect(pruneToListed(tree, new Set([1, 2, 3]))).toEqual([{ id: 1, children: [{ id: 2, children: [{ id: 3, children: [] }] }] }])
  })

  it('drops a node that is not listed', () => {
    expect(pruneToListed(tree, new Set([2, 3]))).toEqual([])
  })
})

describe('categoryHeaderListed', () => {
  it('shows a header with a listed project', () => {
    expect(categoryHeaderListed({ listed: 1, total: 3, mode: 'work', focusActive: false })).toBe(true)
  })

  it('shows an empty category in All and Personal only', () => {
    expect(categoryHeaderListed({ listed: 0, total: 0, mode: 'all', focusActive: false })).toBe(true)
    expect(categoryHeaderListed({ listed: 0, total: 0, mode: 'personal', focusActive: false })).toBe(true)
    expect(categoryHeaderListed({ listed: 0, total: 0, mode: 'work', focusActive: false })).toBe(false)
  })

  it('hides a category whose projects are all out of the list', () => {
    expect(categoryHeaderListed({ listed: 0, total: 2, mode: 'personal', focusActive: false })).toBe(false)
  })

  it('hides an empty category under Pro focus', () => {
    expect(categoryHeaderListed({ listed: 0, total: 0, mode: 'all', focusActive: true })).toBe(false)
  })
})
