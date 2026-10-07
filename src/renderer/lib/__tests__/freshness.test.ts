import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FOCUS_REFRESH_MIN_MS,
  POLL_INTERVAL_MS,
  createFreshness,
  localDayKey,
  msUntilNextLocalMidnight,
} from '../freshness'

const MIN = 60_000
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s, 0)

describe('local day helpers', () => {
  it('keys a date by its local calendar day', () => {
    expect(localDayKey(local(2026, 10, 7, 23, 59, 59))).toBe('2026-10-07')
    expect(localDayKey(local(2026, 1, 2, 0, 0, 0))).toBe('2026-01-02')
  })

  it('counts the milliseconds to the next local midnight, also across a month end', () => {
    expect(msUntilNextLocalMidnight(local(2026, 10, 7, 23, 59, 0))).toBe(60_000)
    expect(msUntilNextLocalMidnight(local(2026, 10, 31, 12, 0, 0))).toBe(12 * 60 * MIN)
    expect(msUntilNextLocalMidnight(local(2026, 10, 7, 0, 0, 0))).toBe(24 * 60 * MIN)
  })
})

describe('createFreshness (D-FRESH-1)', () => {
  let refresh: ReturnType<typeof vi.fn>
  let onDayChange: ReturnType<typeof vi.fn>
  let visible: boolean
  let freshness: ReturnType<typeof createFreshness>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(local(2026, 10, 7, 10, 0, 0))
    refresh = vi.fn()
    onDayChange = vi.fn()
    visible = true
    freshness = createFreshness({ now: () => new Date(), refresh: refresh as () => void, onDayChange: onDayChange as (key: string) => void, isVisible: () => visible })
  })

  afterEach(() => {
    freshness.stop()
    vi.useRealTimers()
  })

  describe('window focus', () => {
    it('refetches on focus', () => {
      freshness.start()
      vi.advanceTimersByTime(FOCUS_REFRESH_MIN_MS + 1000)

      freshness.onFocus()

      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('throttles focus refetches to one per 30 seconds', () => {
      freshness.start()
      freshness.onFocus()
      expect(refresh).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(10_000)
      freshness.onFocus()
      freshness.onFocus()
      expect(refresh).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(FOCUS_REFRESH_MIN_MS)
      freshness.onFocus()
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(FOCUS_REFRESH_MIN_MS).toBe(30_000)
    })

    it('counts a timer refresh towards the throttle', () => {
      freshness.start()
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      expect(refresh).toHaveBeenCalledTimes(1)

      freshness.onFocus()
      expect(refresh).toHaveBeenCalledTimes(1)
    })
  })

  describe('the five-minute poll while the window is visible', () => {
    it('refetches every five minutes', () => {
      freshness.start()

      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      expect(refresh).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      expect(refresh).toHaveBeenCalledTimes(2)
      expect(POLL_INTERVAL_MS).toBe(5 * MIN)
    })

    it('skips the poll while the window is hidden, and refetches as soon as it is visible again', () => {
      freshness.start()
      visible = false

      vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
      expect(refresh).not.toHaveBeenCalled()

      visible = true
      freshness.onVisible()
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('stops polling after stop()', () => {
      freshness.start()
      freshness.stop()
      vi.advanceTimersByTime(POLL_INTERVAL_MS * 3)
      expect(refresh).not.toHaveBeenCalled()
    })
  })

  describe('local midnight', () => {
    it('rolls the day over at midnight and again the next midnight', () => {
      vi.setSystemTime(local(2026, 10, 7, 23, 58, 0))
      freshness.start()

      vi.advanceTimersByTime(MIN)
      expect(onDayChange).not.toHaveBeenCalled()

      vi.advanceTimersByTime(MIN + 1000)
      expect(onDayChange).toHaveBeenCalledTimes(1)
      expect(onDayChange).toHaveBeenLastCalledWith('2026-10-08')

      vi.advanceTimersByTime(24 * 60 * MIN)
      expect(onDayChange).toHaveBeenCalledTimes(2)
      expect(onDayChange).toHaveBeenLastCalledWith('2026-10-09')
    })

    it('does not fire early (a timer that wakes at 23:59:59.9 must not announce the new day)', () => {
      vi.setSystemTime(local(2026, 10, 7, 23, 59, 0))
      freshness.start()
      vi.advanceTimersByTime(59_900)
      expect(onDayChange).not.toHaveBeenCalled()
    })

    it('notices a new day when the computer resumes from sleep, before the midnight timer could run', () => {
      freshness.start()
      vi.setSystemTime(local(2026, 10, 8, 7, 30, 0)) // slept through midnight; timers did not run

      freshness.onResume()

      expect(onDayChange).toHaveBeenCalledTimes(1)
      expect(onDayChange).toHaveBeenCalledWith('2026-10-08')
      expect(refresh).toHaveBeenCalledTimes(1)
    })

    it('re-arms the midnight timer on resume so it still fires at the right time', () => {
      vi.setSystemTime(local(2026, 10, 7, 20, 0, 0))
      freshness.start()
      vi.setSystemTime(local(2026, 10, 7, 23, 0, 0)) // the clock jumped during sleep
      freshness.onResume()
      expect(onDayChange).not.toHaveBeenCalled()

      vi.advanceTimersByTime(60 * MIN + 1000)
      expect(onDayChange).toHaveBeenCalledWith('2026-10-08')
    })

    it('notices a new day on focus too, for a timer that was throttled while the window was hidden', () => {
      freshness.start()
      vi.setSystemTime(local(2026, 10, 8, 8, 0, 0))

      freshness.onFocus()

      expect(onDayChange).toHaveBeenCalledWith('2026-10-08')
    })

    it('reports a day change once however many triggers see it', () => {
      freshness.start()
      vi.setSystemTime(local(2026, 10, 8, 8, 0, 0))

      freshness.onFocus()
      freshness.onVisible()
      freshness.onResume()

      expect(onDayChange).toHaveBeenCalledTimes(1)
    })
  })
})
