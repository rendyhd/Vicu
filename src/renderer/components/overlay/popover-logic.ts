// Pure rules of the popover primitive. No DOM access, so they run under vitest.

/** Distance between the anchor and the popover, in px. */
export const POPOVER_GAP = 6

/** Smallest distance the popover keeps from the window edge, in px. */
export const POPOVER_EDGE = 8

/** A popover never gets squeezed below this height; it scrolls inside instead. */
export const POPOVER_MIN_HEIGHT = 96

/** Maximum height of a popover given the space the placement leaves it. */
export function popoverMaxHeight(available: number): number {
  if (!Number.isFinite(available)) return POPOVER_MIN_HEIGHT
  return Math.max(POPOVER_MIN_HEIGHT, Math.floor(available))
}

/**
 * Arrow-key navigation through the options of a listbox or menu. `current` is the index of the
 * focused option (-1 when focus is not on one). Returns the index to focus next, or null when
 * the key is not a navigation key. Navigation wraps at both ends.
 */
export function nextOptionIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** Selector for the options that arrow keys move between. */
export const OPTION_SELECTOR = '[role="option"],[role="menuitem"]'

/** Selector for elements that can take keyboard focus. */
export const TABBABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Where focus goes when a popover opens. */
export type PopoverInitialFocus = 'first' | 'container' | 'none' | (string & {})
