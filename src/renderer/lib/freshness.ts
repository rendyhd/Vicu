// When the main window refetches its data (D-FRESH-1). TanStack Query refetches on window focus
// only through page visibility, which an Electron window that merely loses focus never changes, and
// nothing polls. So the app does it explicitly:
//
//   - on window focus (throttled to one refetch per 30 s),
//   - every 5 minutes while the window is visible,
//   - when the computer resumes from sleep,
//   - and at local midnight, when the date-dependent views (Today, Upcoming, custom lists with date
//     windows, the overdue badge) have to be recomputed even though no data changed.
//
// The scheduler is plain timers and callbacks so the timing rules are unit-tested with fake timers;
// `useFreshness` wires it to the window, the query client and the day store.

/** Window focus refetches at most this often. */
export const FOCUS_REFRESH_MIN_MS = 30_000
/** Refetch period while the window is visible. */
export const POLL_INTERVAL_MS = 5 * 60_000
/** The midnight timer fires this long after midnight so it can never wake a moment early. */
const MIDNIGHT_GRACE_MS = 500

/** `YYYY-MM-DD` of the local calendar day. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Milliseconds from `now` to the next local midnight (DST-safe: the date is rebuilt, not added to). */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return next.getTime() - now.getTime()
}

export interface FreshnessDeps {
  now(): Date
  /** Refetch the task data (the app's policy decides whether queued changes defer it). */
  refresh(): void
  /** The local calendar day changed; recompute everything that depends on it. */
  onDayChange(dayKey: string): void
  /** Whether the window is visible (not hidden to the tray or minimized). */
  isVisible(): boolean
}

export interface Freshness {
  start(): void
  stop(): void
  onFocus(): void
  onVisible(): void
  /** The computer woke from sleep: timers may have been paused, the clock jumped. */
  onResume(): void
}

export function createFreshness(deps: FreshnessDeps): Freshness {
  let poll: ReturnType<typeof setInterval> | null = null
  let midnight: ReturnType<typeof setTimeout> | null = null
  let lastRefreshAt = Number.NEGATIVE_INFINITY
  let dayKey = localDayKey(deps.now())

  const doRefresh = () => {
    lastRefreshAt = deps.now().getTime()
    deps.refresh()
  }

  const checkDay = () => {
    const key = localDayKey(deps.now())
    if (key === dayKey) return
    dayKey = key
    deps.onDayChange(key)
  }

  const armMidnight = () => {
    if (midnight !== null) clearTimeout(midnight)
    midnight = setTimeout(() => {
      midnight = null
      checkDay()
      armMidnight()
    }, msUntilNextLocalMidnight(deps.now()) + MIDNIGHT_GRACE_MS)
  }

  const throttledRefresh = () => {
    if (deps.now().getTime() - lastRefreshAt < FOCUS_REFRESH_MIN_MS) return
    doRefresh()
  }

  return {
    start() {
      this.stop()
      dayKey = localDayKey(deps.now())
      poll = setInterval(() => {
        if (deps.isVisible()) doRefresh()
      }, POLL_INTERVAL_MS)
      armMidnight()
    },
    stop() {
      if (poll !== null) clearInterval(poll)
      if (midnight !== null) clearTimeout(midnight)
      poll = null
      midnight = null
    },
    onFocus() {
      checkDay()
      throttledRefresh()
    },
    onVisible() {
      checkDay()
      throttledRefresh()
    },
    onResume() {
      checkDay()
      armMidnight()
      doRefresh()
    },
  }
}
