import { afterEach, describe, expect, it, vi } from 'vitest'
import { readReducedMotion, subscribeReducedMotion } from '../use-reduced-motion'

function fakeWindow(initial: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  const matchMedia = vi.fn((q: string) => {
    expect(q).toBe('(prefers-reduced-motion: reduce)')
    return query
  })
  vi.stubGlobal('window', { matchMedia })
  return {
    listeners,
    change: (matches: boolean) => {
      query.matches = matches
      for (const fn of [...listeners]) fn()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('reduced motion setting', () => {
  it('is false where there is no window or matchMedia', () => {
    expect(readReducedMotion()).toBe(false)
    vi.stubGlobal('window', {})
    expect(readReducedMotion()).toBe(false)
    expect(() => subscribeReducedMotion(() => {})()).not.toThrow()
  })

  it('reads the media query', () => {
    fakeWindow(true)
    expect(readReducedMotion()).toBe(true)
  })

  it('tells subscribers when the setting changes, until they unsubscribe', () => {
    const win = fakeWindow(false)
    const notify = vi.fn()
    const unsubscribe = subscribeReducedMotion(notify)
    win.change(true)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(readReducedMotion()).toBe(true)
    unsubscribe()
    win.change(false)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(win.listeners.size).toBe(0)
  })
})
