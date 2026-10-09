import { describe, expect, it } from 'vitest'
import {
  EMPTY_TYPEAHEAD,
  TYPEAHEAD_RESET_MS,
  isTypeaheadKey,
  typeaheadAppend,
  typeaheadMatch,
} from '../typeahead'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
})

describe('isTypeaheadKey', () => {
  it('accepts single characters', () => {
    expect(isTypeaheadKey(key('a'), '')).toBe(true)
    expect(isTypeaheadKey(key('7'), '')).toBe(true)
  })

  it('ignores named keys and modified keys', () => {
    expect(isTypeaheadKey(key('ArrowDown'), '')).toBe(false)
    expect(isTypeaheadKey(key('Enter'), '')).toBe(false)
    expect(isTypeaheadKey(key('c', { ctrlKey: true }), '')).toBe(false)
    expect(isTypeaheadKey(key('c', { metaKey: true }), '')).toBe(false)
    expect(isTypeaheadKey(key('c', { altKey: true }), '')).toBe(false)
  })

  it('takes a space only inside a search', () => {
    expect(isTypeaheadKey(key(' '), '')).toBe(false)
    expect(isTypeaheadKey(key(' '), 'move')).toBe(true)
  })
})

describe('typeaheadAppend', () => {
  it('extends the search while typing continues', () => {
    const first = typeaheadAppend(EMPTY_TYPEAHEAD, 'M', 1000)
    expect(first.buffer).toBe('m')
    expect(typeaheadAppend(first, 'o', 1000 + TYPEAHEAD_RESET_MS).buffer).toBe('mo')
  })

  it('starts again after a pause', () => {
    const first = typeaheadAppend(EMPTY_TYPEAHEAD, 'm', 1000)
    expect(typeaheadAppend(first, 'c', 1001 + TYPEAHEAD_RESET_MS).buffer).toBe('c')
  })
})

describe('typeaheadMatch', () => {
  const labels = ['Copy task', 'Complete task', 'Delete task', 'Move to project']

  it('finds the first item that starts with the search', () => {
    expect(typeaheadMatch(labels, -1, 'd')).toBe(2)
    expect(typeaheadMatch(labels, -1, 'mo')).toBe(3)
  })

  it('steps through items with the same first letter when one letter is repeated', () => {
    expect(typeaheadMatch(labels, -1, 'c')).toBe(0)
    expect(typeaheadMatch(labels, 0, 'c')).toBe(1)
    expect(typeaheadMatch(labels, 1, 'c')).toBe(0)
    expect(typeaheadMatch(labels, 0, 'cc')).toBe(1)
  })

  it('keeps the focused item when a longer search still fits it', () => {
    expect(typeaheadMatch(labels, 1, 'com')).toBe(1)
    expect(typeaheadMatch(labels, 0, 'com')).toBe(1)
  })

  it('wraps past the end', () => {
    expect(typeaheadMatch(labels, 3, 'c')).toBe(0)
  })

  it('ignores case and surrounding space', () => {
    expect(typeaheadMatch(['  Alpha', 'beta'], -1, 'B')).toBe(1)
  })

  it('returns null when nothing matches or there is nothing to search', () => {
    expect(typeaheadMatch(labels, -1, 'z')).toBeNull()
    expect(typeaheadMatch(labels, -1, '')).toBeNull()
    expect(typeaheadMatch([], -1, 'a')).toBeNull()
  })
})
