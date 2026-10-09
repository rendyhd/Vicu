import { describe, expect, it } from 'vitest'
import { nextRowAfterRemoval } from '../row-focus'

describe('nextRowAfterRemoval', () => {
  const order = [1, 2, 3, 4, 5, 6]

  it('picks the first remaining row after the last removed one', () => {
    expect(nextRowAfterRemoval(order, new Set([2, 3]))).toBe(4)
    expect(nextRowAfterRemoval(order, new Set([1, 4]))).toBe(5)
  })

  it('skips removed rows that sit between', () => {
    expect(nextRowAfterRemoval(order, new Set([2, 3, 4, 5]))).toBe(6)
  })

  it('falls back to the last remaining row before when the removed ones end the list', () => {
    expect(nextRowAfterRemoval(order, new Set([5, 6]))).toBe(4)
    expect(nextRowAfterRemoval(order, new Set([2, 4, 5, 6]))).toBe(3)
  })

  it('is null when nothing remains', () => {
    expect(nextRowAfterRemoval([1, 2], new Set([1, 2]))).toBeNull()
    expect(nextRowAfterRemoval([], new Set([1]))).toBeNull()
  })
})
