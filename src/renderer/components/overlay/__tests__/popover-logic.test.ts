import { describe, expect, it } from 'vitest'
import { POPOVER_MIN_HEIGHT, nextOptionIndex, popoverMaxHeight } from '../popover-logic'

describe('popoverMaxHeight', () => {
  it('uses the space the placement leaves, rounded down', () => {
    expect(popoverMaxHeight(412.9)).toBe(412)
  })

  it('never squeezes a popover below its minimum', () => {
    expect(popoverMaxHeight(20)).toBe(POPOVER_MIN_HEIGHT)
    expect(popoverMaxHeight(-40)).toBe(POPOVER_MIN_HEIGHT)
  })

  it('falls back to the minimum when the space is not a number', () => {
    expect(popoverMaxHeight(Number.NaN)).toBe(POPOVER_MIN_HEIGHT)
  })
})

describe('nextOptionIndex', () => {
  it('moves down and wraps to the first option', () => {
    expect(nextOptionIndex(0, 3, 'ArrowDown')).toBe(1)
    expect(nextOptionIndex(2, 3, 'ArrowDown')).toBe(0)
  })

  it('moves up and wraps to the last option', () => {
    expect(nextOptionIndex(2, 3, 'ArrowUp')).toBe(1)
    expect(nextOptionIndex(0, 3, 'ArrowUp')).toBe(2)
  })

  it('starts at the first option going down and the last going up when focus is not on an option', () => {
    expect(nextOptionIndex(-1, 4, 'ArrowDown')).toBe(0)
    expect(nextOptionIndex(-1, 4, 'ArrowUp')).toBe(3)
  })

  it('jumps to the ends with Home and End', () => {
    expect(nextOptionIndex(2, 5, 'Home')).toBe(0)
    expect(nextOptionIndex(1, 5, 'End')).toBe(4)
  })

  it('ignores other keys and empty lists', () => {
    expect(nextOptionIndex(1, 3, 'Enter')).toBeNull()
    expect(nextOptionIndex(1, 3, 'a')).toBeNull()
    expect(nextOptionIndex(-1, 0, 'ArrowDown')).toBeNull()
  })
})
