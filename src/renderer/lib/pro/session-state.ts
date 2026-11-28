/**
 * A session that is running (cross-app semantics 21.17), kept per device until it ends: its round
 * id is chosen at the start, so what is captured in it can name it. Nothing here is synced; the
 * round is written when the session ends.
 */
export interface SessionState {
  round: string
  /** When it started (a UTC instant). */
  started: string
  /** The step shown, an index into the kind's steps. */
  step: number
  absent: number[]
  readBack: boolean
  score: number | null
}

/** While a session runs it has no end yet: everything from its start on is in it. */
export const RUNNING_SESSION_END = '9999-12-31T23:59:59.999Z'

/** How far a server's clock may run ahead of this device's and still be taken for the same moment. */
const MAX_CLOCK_AHEAD_MS = 5 * 60 * 1000

/**
 * When a session ends: now, or a little later when an action made in it carries a later time. A
 * task's `created` is the server's clock, which can run ahead of this device's; a session that
 * ended "before" an action made in its last seconds would leave that action out of its recap.
 */
export function sessionEndTime(now: Date, started: string, created: ReadonlyArray<string | null | undefined>): string {
  const start = new Date(started).getTime()
  const limit = now.getTime() + MAX_CLOCK_AHEAD_MS
  let end = now.getTime()
  for (const at of created) {
    const time = at ? new Date(at).getTime() : Number.NaN
    if (!Number.isNaN(time) && time >= start && time > end && time <= limit) end = time
  }
  return new Date(end).toISOString()
}

const PREFIX = 'vicu-pro-session:'
const storageKey = (meetingId: string, kind: string) => `${PREFIX}${meetingId}:${kind}`

function read(key: string): SessionState | null {
  try {
    const raw = localStorage.getItem(key)
    const value = raw ? (JSON.parse(raw) as Partial<SessionState>) : null
    if (!value || typeof value.round !== 'string' || typeof value.started !== 'string') return null
    return {
      round: value.round,
      started: value.started,
      step: typeof value.step === 'number' ? value.step : 0,
      absent: Array.isArray(value.absent) ? value.absent.filter((id): id is number => typeof id === 'number') : [],
      readBack: value.readBack === true,
      score: typeof value.score === 'number' ? value.score : null,
    }
  } catch {
    return null
  }
}

export function loadSession(meetingId: string, kind: string): SessionState | null {
  return read(storageKey(meetingId, kind))
}

export function saveSession(meetingId: string, kind: string, state: SessionState | null): void {
  try {
    if (state) localStorage.setItem(storageKey(meetingId, kind), JSON.stringify(state))
    else localStorage.removeItem(storageKey(meetingId, kind))
  } catch {
    // The session still runs; it is only not kept across a reload.
  }
}

/** The round id of a session of this group that is running now, of any kind; null without one. */
export function runningSessionOf(meetingId: string): string | null {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(`${PREFIX}${meetingId}:`)) {
        const state = read(key)
        if (state) return state.round
      }
    }
  } catch {
    // No storage: nothing is running.
  }
  return null
}
