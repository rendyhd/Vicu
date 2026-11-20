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
