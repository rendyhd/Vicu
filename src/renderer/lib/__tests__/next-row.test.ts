import { describe, expect, it } from 'vitest'
import { pickNextRow } from '../next-row'

describe('pickNextRow', () => {
  const rows = [
    { id: 1, done: false },
    { id: 2, done: false },
    { id: 3, done: true },
    { id: 4, done: false },
  ]

  it('is the next open row', () => {
    expect(pickNextRow(rows, 1)).toBe(2)
  })

  it('skips rows that are done and the current row, whose done flag may not be on screen yet', () => {
    expect(pickNextRow(rows, 2)).toBe(4)
    expect(pickNextRow([{ id: 1, done: false }, { id: 2, done: false }], 1)).toBe(2)
  })

  it('falls back to the previous open row at the end of the list', () => {
    expect(pickNextRow(rows, 4)).toBe(2)
  })

  it('is null when no other row is open', () => {
    expect(pickNextRow([{ id: 1, done: false }], 1)).toBeNull()
    expect(pickNextRow([{ id: 1, done: false }, { id: 2, done: true }], 1)).toBeNull()
    expect(pickNextRow([], 1)).toBeNull()
  })
})
