import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { completedDueFor, decideRepeatCompletion, dueInstant, isRepeatingTask, type RepeatCompletionTask } from '../repeat-completion'

interface Vector {
  name: string
  completedDue: string | null
  server: RepeatCompletionTask
  expect: 'send' | 'skip'
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8'),
) as { repeatCompletion: { vectors: Vector[] } }

describe('repeatCompletion vectors (cross-app semantics 7.5)', () => {
  it('has vectors', () => {
    expect(fixture.repeatCompletion.vectors.length).toBeGreaterThan(0)
  })

  for (const vector of fixture.repeatCompletion.vectors) {
    it(vector.name, () => {
      expect(decideRepeatCompletion(vector.completedDue, vector.server)).toBe(vector.expect)
    })
  }
})

describe('repeat completion helpers', () => {
  it('reads no date from null, empty and the zero time', () => {
    expect(dueInstant(null)).toBeNull()
    expect(dueInstant('')).toBeNull()
    expect(dueInstant('0001-01-01T00:00:00Z')).toBeNull()
    expect(dueInstant('not a date')).toBeNull()
    expect(dueInstant('2026-11-13T22:59:59Z')).toBe(Date.parse('2026-11-13T22:59:59Z'))
  })

  it('tells a repeating task', () => {
    expect(isRepeatingTask({ repeat_after: 86400, repeat_mode: 0 })).toBe(true)
    expect(isRepeatingTask({ repeat_after: 0, repeat_mode: 1 })).toBe(true)
    expect(isRepeatingTask({ repeat_after: 0, repeat_mode: 0 })).toBe(false)
    expect(isRepeatingTask({})).toBe(false)
  })

  it('remembers the completed due only for a repeating task', () => {
    expect(completedDueFor({ repeat_after: 86400, due_date: '2026-11-13T22:59:59Z' })).toBe('2026-11-13T22:59:59Z')
    expect(completedDueFor({ repeat_after: 86400 })).toBeNull()
    expect(completedDueFor({ repeat_after: 0, due_date: '2026-11-13T22:59:59Z' })).toBeUndefined()
  })
})
