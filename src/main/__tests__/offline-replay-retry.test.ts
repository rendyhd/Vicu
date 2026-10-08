import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPLAY_RETRY_DELAYS_MS, createReplayRetry } from '../offline/replay-retry'
import type { OfflineReplayStop } from '../../shared/offline-queue-types'

const counts = (pending: number) => ({ pending, failed: 0 })
const stopped = (why: OfflineReplayStop | null, pending = 2) => ({ stopped: why, counts: counts(pending) }) as Parameters<ReturnType<typeof createReplayRetry>['afterReplay']>[0]

describe('replay retry after a server or network problem', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries after 5 s, then 15 s, then every 60 s while the replay keeps stopping', () => {
    const run = vi.fn()
    const retry = createReplayRetry(run)
    expect(REPLAY_RETRY_DELAYS_MS).toEqual([5_000, 15_000, 60_000])

    retry.afterReplay(stopped('server'))
    vi.advanceTimersByTime(4_999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)

    retry.afterReplay(stopped('server'))
    vi.advanceTimersByTime(14_999)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(2)

    for (let i = 0; i < 3; i++) {
      retry.afterReplay(stopped('network'))
      vi.advanceTimersByTime(59_999)
      expect(run).toHaveBeenCalledTimes(2 + i)
      vi.advanceTimersByTime(1)
      expect(run).toHaveBeenCalledTimes(3 + i)
    }
  })

  it('starts over at 5 s after a replay that finished, and stops when nothing is left', () => {
    const run = vi.fn()
    const retry = createReplayRetry(run)
    retry.afterReplay(stopped('server'))
    vi.advanceTimersByTime(5_000)
    retry.afterReplay(stopped('server'))
    retry.afterReplay(stopped(null, 0))
    vi.advanceTimersByTime(120_000)
    expect(run).toHaveBeenCalledTimes(1)

    retry.afterReplay(stopped('rate-limit'))
    vi.advanceTimersByTime(5_000)
    expect(run).toHaveBeenCalledTimes(2)
    retry.afterReplay(null)
    vi.advanceTimersByTime(120_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('leaves a session or setup problem to the user', () => {
    const run = vi.fn()
    const retry = createReplayRetry(run)
    retry.afterReplay(stopped('auth'))
    retry.afterReplay(stopped('config'))
    vi.advanceTimersByTime(300_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps one timer: a replay that ran meanwhile replaces the scheduled try', () => {
    const run = vi.fn()
    const retry = createReplayRetry(run)
    retry.afterReplay(stopped('server'))
    vi.advanceTimersByTime(3_000)
    retry.afterReplay(stopped('server'))
    vi.advanceTimersByTime(14_999)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    retry.cancel()
    retry.afterReplay(stopped('network'))
    retry.cancel()
    vi.advanceTimersByTime(300_000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
