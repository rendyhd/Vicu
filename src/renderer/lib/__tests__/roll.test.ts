import { describe, expect, it } from 'vitest'
import { rollDirection } from '../roll'

describe('rollDirection', () => {
  it('rolls up for a larger count and down for a smaller one', () => {
    expect(rollDirection(5, 6)).toBe('up')
    expect(rollDirection(6, 5)).toBe('down')
    expect(rollDirection(0, 12)).toBe('up')
  })
  it('does not roll when the count is the same', () => {
    expect(rollDirection(3, 3)).toBeNull()
  })
})
