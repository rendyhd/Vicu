import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({ flushSync: (fn: () => void) => fn() }))

import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { commitSync } from '../sync-commit'

describe('commitSync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('notifies at once inside the update and puts the scheduler that was set before back', () => {
    const set = vi.spyOn(notifyManager, 'setScheduler')
    commitSync(() => {})
    expect(set).toHaveBeenCalledTimes(2)
    const ran = vi.fn()
    set.mock.calls[0][0](ran)
    expect(ran).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[1][0]).toBe(defaultScheduler)
  })

  it('restores it when the update throws, and nested commits unwind one level at a time', () => {
    const set = vi.spyOn(notifyManager, 'setScheduler')
    expect(() => commitSync(() => { throw new Error('x') })).toThrow('x')
    expect(set.mock.calls[1][0]).toBe(defaultScheduler)

    set.mockClear()
    commitSync(() => commitSync(() => {}))
    const [outer, inner, innerDone, outerDone] = set.mock.calls.map((call) => call[0])
    expect(innerDone).toBe(outer)
    expect(outerDone).toBe(defaultScheduler)
    expect(inner).not.toBe(defaultScheduler)
  })
})
