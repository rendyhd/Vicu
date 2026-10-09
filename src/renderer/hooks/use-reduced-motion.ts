import { useSyncExternalStore } from 'react'

// Whether the user asked for less motion (card 1.5). The CSS base layer in assets/index.css covers
// transitions and the spinner; JS motion (a spring, a height animation, a timed FLIP) reads this
// hook and falls back to a fade. It follows the setting live: the media query is subscribed, not
// read once.

const QUERY = '(prefers-reduced-motion: reduce)'

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

/** The current setting; false where there is no matchMedia. */
export function readReducedMotion(): boolean {
  return media()?.matches ?? false
}

/** Calls `notify` whenever the setting changes; returns the unsubscribe function. */
export function subscribeReducedMotion(notify: () => void): () => void {
  const query = media()
  if (!query) return () => {}
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)
}
