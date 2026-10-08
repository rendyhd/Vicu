import { beforeEach, describe, expect, it } from 'vitest'
import { clearRepeatSnapshots, rememberRepeatCompletion, repeatUndoPatch, takeRepeatSnapshot } from '../repeat-undo'
import { NULL_DATE } from '../constants'
import type { Task } from '../vikunja-types'

const task = (overrides: Partial<Task> = {}) =>
  ({
    id: 4,
    title: 'Water plants',
    done: false,
    due_date: '2026-10-10T09:00:00Z',
    start_date: NULL_DATE,
    end_date: NULL_DATE,
    reminders: [{ reminder: '2026-10-10T08:00:00Z' }],
    repeat_after: 604_800,
    ...overrides,
  }) as Task

describe('repeat undo', () => {
  beforeEach(() => clearRepeatSnapshots())

  it('remembers a task that came back open with moved dates', () => {
    rememberRepeatCompletion(task(), task({ due_date: '2026-10-17T09:00:00Z' }))
    expect(takeRepeatSnapshot(4)?.before.due_date).toBe('2026-10-10T09:00:00Z')
    expect(takeRepeatSnapshot(4)).toBeNull()
  })

  it('remembers moved reminders and start or end dates too', () => {
    rememberRepeatCompletion(task(), task({ reminders: [{ reminder: '2026-10-17T08:00:00Z' }] }))
    expect(takeRepeatSnapshot(4)).not.toBeNull()
    rememberRepeatCompletion(task(), task({ end_date: '2026-10-17T09:00:00Z' }))
    expect(takeRepeatSnapshot(4)).not.toBeNull()
  })

  it('forgets nothing it should keep and keeps nothing for a task that is done or did not move', () => {
    rememberRepeatCompletion(task(), task({ done: true, due_date: '2026-10-17T09:00:00Z' }))
    rememberRepeatCompletion(task(), task())
    rememberRepeatCompletion(task(), null)
    expect(takeRepeatSnapshot(4)).toBeNull()
  })

  it('restores only what differs, clearing dates with null', () => {
    rememberRepeatCompletion(task({ start_date: '2026-10-09T09:00:00Z' }), task({ start_date: NULL_DATE, due_date: '2026-10-17T09:00:00Z' }))
    const snapshot = takeRepeatSnapshot(4)!
    const patch = repeatUndoPatch(snapshot, task({ start_date: NULL_DATE, due_date: '2026-10-17T09:00:00Z' }))
    expect(patch).toEqual({ due_date: '2026-10-10T09:00:00Z', start_date: '2026-10-09T09:00:00Z' })
  })

  it('sends nothing when a field was edited since the completion', () => {
    rememberRepeatCompletion(task(), task({ due_date: '2026-10-17T09:00:00Z' }))
    const snapshot = takeRepeatSnapshot(4)!
    expect(repeatUndoPatch(snapshot, task({ due_date: '2026-10-19T09:00:00Z' }))).toEqual({})
    expect(repeatUndoPatch(snapshot, task({ due_date: '2026-10-17T09:00:00Z', reminders: [] }))).toEqual({})
  })
})
