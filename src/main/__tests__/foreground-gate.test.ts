import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FOREGROUND_LOOKUP_TIMEOUT_MS,
  foregroundNeeds,
  lookUpForeground,
} from '../quick-entry/foreground-gate'

describe('foreground app lookup for Quick Entry (D-PERF-1)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('who needs it', () => {
    it('nobody with the Obsidian and browser links off', () => {
      expect(foregroundNeeds(null, false)).toEqual({ obsidian: false, browser: false, any: false })
      expect(foregroundNeeds({}, false).any).toBe(false)
      expect(foregroundNeeds({ obsidian_mode: 'off', browser_link_mode: 'off' }, false).any).toBe(false)
      // A mode without an API key cannot fetch a note.
      expect(foregroundNeeds({ obsidian_mode: 'ask', obsidian_api_key: '' }, false).any).toBe(false)
    })

    it('the Obsidian link when it is on and has a key', () => {
      expect(foregroundNeeds({ obsidian_mode: 'ask', obsidian_api_key: 'k' }, false)).toEqual({ obsidian: true, browser: false, any: true })
      expect(foregroundNeeds({ obsidian_mode: 'always', obsidian_api_key: 'k' }, false).obsidian).toBe(true)
    })

    it('the browser link when it is on', () => {
      expect(foregroundNeeds({ browser_link_mode: 'ask' }, false)).toEqual({ obsidian: false, browser: true, any: true })
      expect(foregroundNeeds({ browser_link_mode: 'always' }, false).browser).toBe(true)
    })

    it('never Obsidian on Linux', () => {
      expect(foregroundNeeds({ obsidian_mode: 'ask', obsidian_api_key: 'k' }, true).any).toBe(false)
      expect(foregroundNeeds({ obsidian_mode: 'ask', obsidian_api_key: 'k', browser_link_mode: 'ask' }, true)).toEqual({ obsidian: false, browser: true, any: true })
    })
  })

  describe('the lookup', () => {
    it('does not run at all when no feature needs it, so the window is not held up', async () => {
      const getName = vi.fn(async () => 'obsidian')
      expect(await lookUpForeground(foregroundNeeds({}, false), getName)).toBe('')
      expect(getName).not.toHaveBeenCalled()
    })

    it('runs once when a link feature is on and returns the process name', async () => {
      const getName = vi.fn(async () => 'obsidian')
      const needs = foregroundNeeds({ obsidian_mode: 'ask', obsidian_api_key: 'k' }, false)
      expect(await lookUpForeground(needs, getName)).toBe('obsidian')
      expect(getName).toHaveBeenCalledTimes(1)
    })

    it('gives up after the timeout so a slow osascript cannot hold the window back', async () => {
      vi.useFakeTimers()
      const getName = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve('chrome'), 5_000)))
      const needs = foregroundNeeds({ browser_link_mode: 'ask' }, false)

      const result = lookUpForeground(needs, getName)
      await vi.advanceTimersByTimeAsync(FOREGROUND_LOOKUP_TIMEOUT_MS)
      expect(await result).toBe('')
    })

    it('is quick when the answer is quick: nothing is left waiting on the timer', async () => {
      vi.useFakeTimers()
      const needs = foregroundNeeds({ browser_link_mode: 'ask' }, false)
      expect(await lookUpForeground(needs, async () => 'chrome')).toBe('chrome')
      expect(vi.getTimerCount()).toBe(0)
    })

    it('treats a failing lookup as unknown', async () => {
      const needs = foregroundNeeds({ browser_link_mode: 'ask' }, false)
      expect(await lookUpForeground(needs, async () => { throw new Error('osascript failed') })).toBe('')
    })
  })
})
