import type { OfflineReplayEvent } from '../../shared/offline-queue-types'

/** How long to wait before the next replay after one stopped on a server or network problem. The last delay repeats. */
export const REPLAY_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 60_000]

/** Why a stopped replay is worth another try soon. A session or setup problem waits for the user, not for a timer. */
const RETRIABLE_STOPS: ReadonlySet<string> = new Set(['network', 'server', 'rate-limit', 'unknown'])

export interface ReplayRetryOptions {
  delays?: readonly number[]
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ReplayRetry {
  /**
   * Tell the retry how a replay ended (null: nothing to replay). A replay that stopped with changes
   * still waiting schedules the next try; anything else clears the schedule and starts the delays over.
   */
  afterReplay(event: Pick<OfflineReplayEvent, 'stopped' | 'counts'> | null): void
  /** Forget a scheduled try. */
  cancel(): void
}

/**
 * Backs off between replays after a 5xx, 429 or network error (5 s, 15 s, 60 s, then every 60 s). The
 * replay itself keeps the queue and stops on those errors; without this the queue would sit until
 * the five minute timer, even when the server is fine a moment later. Any other replay that runs in
 * between replaces the scheduled one, so there is never more than one timer.
 */
export function createReplayRetry(run: () => void, options: ReplayRetryOptions = {}): ReplayRetry {
  const delays = options.delays ?? REPLAY_RETRY_DELAYS_MS
  const setTimer = options.setTimer ?? ((fn, ms) => {
    const handle = setTimeout(fn, ms)
    handle.unref?.()
    return handle
  })
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  let attempt = 0

  const cancel = (): void => {
    if (handle !== null) clearTimer(handle)
    handle = null
  }

  return {
    cancel,
    afterReplay(event) {
      cancel()
      if (!event || event.stopped === null || !RETRIABLE_STOPS.has(event.stopped) || event.counts.pending === 0) {
        attempt = 0
        return
      }
      const delay = delays[Math.min(attempt, delays.length - 1)]
      attempt++
      handle = setTimer(() => {
        handle = null
        run()
      }, delay)
    },
  }
}
