/**
 * A meeting round (docs/cross-app-semantics-v1.md section 21.9): the people of a meeting in any
 * order, skipping allowed, no timer (decision 12). Pure: every step takes the state and returns the
 * next. Both apps run the `pro.meetingRound` vectors (the round itself runs on desktop only).
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import type { RoundValue } from './ledger'

/** Your own card in the round: promises you owe the room. */
export const ME = 0

export interface RoundState {
  /** The meeting's people in order; `ME` (0) for your own card. */
  queue: number[]
  current: number | null
  discussed: number[]
  skipped: number[]
  absent: number[]
}

const without = (list: readonly number[], person: number) => list.filter((id) => id !== person)

export function startRound(people: readonly number[], withMe = true): RoundState {
  const queue = [...new Set(people.filter((id) => id !== ME))]
  if (withMe) queue.push(ME)
  return { queue, current: queue[0] ?? null, discussed: [], skipped: [], absent: [] }
}

/** The next person after `from` in queue order (wrapping) not yet discussed, skipped or absent. */
function nextAfter(state: RoundState, from: number | null): number | null {
  const done = new Set([...state.discussed, ...state.skipped, ...state.absent])
  const start = from === null ? -1 : state.queue.indexOf(from)
  for (let step = 1; step <= state.queue.length; step++) {
    const candidate = state.queue[(start + step + state.queue.length) % state.queue.length]
    if (!done.has(candidate)) return candidate
  }
  return null
}

/** Jump to anyone; a skipped or absent person picked again is back in the round. */
export function pickPerson(state: RoundState, person: number): RoundState {
  if (!state.queue.includes(person)) return state
  return { ...state, current: person, skipped: without(state.skipped, person), absent: without(state.absent, person), discussed: without(state.discussed, person) }
}

/** Done with the current person: discussed, then on to the next. */
export function nextPerson(state: RoundState): RoundState {
  if (state.current === null) return state
  const next = { ...state, discussed: [...without(state.discussed, state.current), state.current] }
  return { ...next, current: nextAfter(next, state.current) }
}

/** Skip the current person for now; picking them later brings them back. */
export function skipPerson(state: RoundState): RoundState {
  if (state.current === null) return state
  const next = { ...state, skipped: [...without(state.skipped, state.current), state.current] }
  return { ...next, current: nextAfter(next, state.current) }
}

/** Mark someone absent; when it is the current person, on to the next. */
export function markAbsent(state: RoundState, person: number): RoundState {
  if (!state.queue.includes(person)) return state
  const next = {
    ...state,
    absent: [...without(state.absent, person), person],
    skipped: without(state.skipped, person),
    discussed: without(state.discussed, person),
  }
  return state.current === person ? { ...next, current: nextAfter(next, person) } : next
}

/**
 * The round record when the meeting ends: discussed (the current person counts when the meeting
 * ends on them), skipped, absent, and not discussed (everyone else). Lists keep queue order; your own
 * card is left out of every list.
 */
export function endRound(state: RoundState, meetingId: string, at: string): RoundValue {
  const final = state.current === null ? state : nextPerson(state)
  const inQueue = (ids: readonly number[]) => state.queue.filter((id) => id !== ME && ids.includes(id))
  const seen = new Set([...final.discussed, ...final.skipped, ...final.absent])
  return {
    meeting: meetingId,
    at,
    discussed: inQueue(final.discussed),
    skipped: inQueue(final.skipped),
    absent: inQueue(final.absent),
    not_discussed: state.queue.filter((id) => id !== ME && !seen.has(id)),
  }
}
