// Type-to-select for listboxes and menus (the WAI-ARIA "type-ahead" behaviour). Pure helpers, no
// DOM access, so they run under vitest. The popover keeps one TypeaheadState per instance.

/** Typing pauses longer than this start a new search. */
export const TYPEAHEAD_RESET_MS = 700

export interface TypeaheadState {
  buffer: string
  /** Time of the last key, in ms. */
  at: number
}

export const EMPTY_TYPEAHEAD: TypeaheadState = { buffer: '', at: 0 }

/**
 * Whether a key press is a character for the search. A space only counts once a search is under
 * way (alone it activates the focused item); modified keys never count.
 */
export function isTypeaheadKey(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  buffer: string,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  if (event.key.length !== 1) return false
  if (event.key === ' ') return buffer !== ''
  return true
}

/** Adds a character to the search; a pause since the last key starts it afresh. */
export function typeaheadAppend(state: TypeaheadState, key: string, now: number): TypeaheadState {
  const fresh = now - state.at > TYPEAHEAD_RESET_MS
  return { buffer: (fresh ? '' : state.buffer) + key.toLowerCase(), at: now }
}

/**
 * The index of the item the search lands on, or null when nothing starts with it. `current` is the
 * focused item (-1 for none). One character, or the same character repeated, steps to the next
 * item that starts with it and wraps. A longer search looks from the focused item on, so adding a
 * letter keeps the focus where it already fits.
 */
export function typeaheadMatch(labels: readonly string[], current: number, buffer: string): number | null {
  const query = buffer.toLowerCase()
  const count = labels.length
  if (query === '' || count === 0) return null
  const repeated = [...query].every((char) => char === query[0])
  const needle = repeated ? query[0] : query
  const start = repeated ? current + 1 : Math.max(current, 0)
  for (let step = 0; step < count; step++) {
    const index = (((start + step) % count) + count) % count
    if (labels[index].trim().toLowerCase().startsWith(needle)) return index
  }
  return null
}
