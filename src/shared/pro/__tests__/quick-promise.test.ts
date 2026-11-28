import { describe, expect, it } from 'vitest'
import { quickPromiseValue } from '../quick-promise'

describe('the promise Quick Entry adds', () => {
  it('needs a person', () => {
    expect(quickPromiseValue(0, false)).toBeNull()
    expect(quickPromiseValue('7', false)).toBeNull()
    expect(quickPromiseValue(1.5, true)).toBeNull()
  })

  it('writes the person and the direction', () => {
    expect(quickPromiseValue(7, false)).toEqual({ dir: 'theirs', person: 7 })
    expect(quickPromiseValue(7, true)).toEqual({ dir: 'mine', person: 7 })
    expect(quickPromiseValue(7, 'yes')).toEqual({ dir: 'theirs', person: 7 })
  })

  it('keeps who it was promised to and the check day when they read', () => {
    expect(quickPromiseValue(7, false, { to: { person: 9 }, check_on: '2026-11-23' })).toEqual({ dir: 'theirs', person: 7, to: { person: 9 }, check_on: '2026-11-23' })
    expect(quickPromiseValue(7, false, { to: { text: '  the board ' } })).toEqual({ dir: 'theirs', person: 7, to: { text: 'the board' } })
  })

  it('leaves out what does not read', () => {
    expect(quickPromiseValue(7, false, { to: { person: -1 }, check_on: 'monday' })).toEqual({ dir: 'theirs', person: 7 })
    expect(quickPromiseValue(7, false, { to: { text: '   ' } })).toEqual({ dir: 'theirs', person: 7 })
    expect(quickPromiseValue(7, false, 'x')).toEqual({ dir: 'theirs', person: 7 })
    expect(quickPromiseValue(7, false, { to: { group: 3 }, dir: 'mine', verdicts: [] })).toEqual({ dir: 'theirs', person: 7 })
  })
})
