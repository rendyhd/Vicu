import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleTimeout } from '../idle-timeout'

describe('createIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires when nothing happens for the whole period', () => {
    const onIdle = vi.fn()
    createIdleTimeout(1000, onIdle)
    vi.advanceTimersByTime(999)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('restarts on activity, so a long transfer that keeps moving never times out', () => {
    const onIdle = vi.fn()
    const idle = createIdleTimeout(1000, onIdle)
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(900)
      idle.touch()
    }
    // 45 seconds elapsed in total, far past the 1 second period.
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('does not fire after it was cleared, and touching it again does not restart it', () => {
    const onIdle = vi.fn()
    const idle = createIdleTimeout(1000, onIdle)
    idle.clear()
    idle.touch()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('fires only once', () => {
    const onIdle = vi.fn()
    const idle = createIdleTimeout(1000, onIdle)
    vi.advanceTimersByTime(1000)
    idle.touch()
    vi.advanceTimersByTime(5000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
