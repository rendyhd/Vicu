import { describe, expect, it } from 'vitest'
import { openCount, showsGroupHeader } from '../list-sections'

describe('openCount', () => {
  it('counts the tasks that are not done, so a completed task lowers the number', () => {
    const tasks = [{ done: false }, { done: false }, { done: true }]
    expect(openCount(tasks)).toBe(2)
    expect(openCount([{ done: false }, { done: true }, { done: true }])).toBe(1)
    expect(openCount([])).toBe(0)
  })

  it('counts a task without a done flag as open', () => {
    expect(openCount([{}, { done: true }])).toBe(1)
  })
})

describe('showsGroupHeader', () => {
  it('gives a group of one task no header', () => {
    expect(showsGroupHeader([1])).toBe(false)
    expect(showsGroupHeader([])).toBe(false)
    expect(showsGroupHeader([1, 2])).toBe(true)
  })
})
