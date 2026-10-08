import { describe, expect, it } from 'vitest'
import { parseCssMs } from '../row-close'
import { pickNextRow } from '../next-row'

describe('parseCssMs', () => {
  it('reads milliseconds and seconds', () => {
    expect(parseCssMs('320ms', 1)).toBe(320)
    expect(parseCssMs(' 150ms ', 1)).toBe(150)
    expect(parseCssMs('0.32s', 1)).toBeCloseTo(320)
  })

  it('falls back when the value is empty or not a time', () => {
    expect(parseCssMs('', 320)).toBe(320)
    expect(parseCssMs('auto', 320)).toBe(320)
  })
})

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
