import { flushSync } from 'react-dom'
import { readReducedMotion } from '@/hooks/use-reduced-motion'
import { motionMs } from './motion'

// Opening and closing a task (card 4.4). The collapsed row and the open card of one task share a
// view-transition-name, so the browser morphs one into the other (assets/index.css gives the group
// the move spring). Only the tasks involved carry the name, and only while the transition runs: a
// name on every row would make the browser capture all of them. The state change itself is
// applied through flushSync inside the transition callback, so the new DOM exists when the browser
// takes the "after" snapshot.
//
// html[data-task-transition] is "morph" while a transition runs and "fade" under reduced motion
// (no morph, the new row or card fades in over fade.fast); the CSS keys the content stagger and the
// fade on it. One transition runs at a time: a new request skips the running one (it jumps to its
// end state) and starts from there, so the latest always wins.

const ATTRIBUTE = 'data-task-transition'
const NAMED = 'data-vt-named'

let running: ViewTransition | null = null
let fadeTimer: ReturnType<typeof setTimeout> | undefined

/** The view-transition-name of a task's row and card. */
export const taskTransitionName = (id: number) => `task-${id}`

/** The tasks a change of the expanded task touches: the one closing and the one opening. */
export function transitionIds(from: number | null, to: number | null): number[] {
  return [...new Set([from, to].filter((id): id is number => id !== null))]
}

function nameElements(ids: readonly number[]): void {
  for (const id of ids) {
    // The first element of the task in the document; a task shown twice would make the name a duplicate.
    const el = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
    if (!el) continue
    el.style.viewTransitionName = taskTransitionName(id)
    el.setAttribute(NAMED, '')
  }
}

function clearNames(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${NAMED}]`))) {
    el.style.viewTransitionName = ''
    el.removeAttribute(NAMED)
  }
}

/**
 * Applies `update` (a change of the expanded task) with the open/close motion for `ids`. Without a
 * document, a browser that has no view transitions, or with nothing to morph, it just runs `update`.
 */
export function runTaskTransition(ids: readonly number[], update: () => void): void {
  if (typeof document === 'undefined' || ids.length === 0) {
    update()
    return
  }
  const root = document.documentElement

  if (readReducedMotion()) {
    // No morph: the row or card that appears fades in (CSS, keyed on the attribute).
    root.setAttribute(ATTRIBUTE, 'fade')
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => root.removeAttribute(ATTRIBUTE), motionMs('fade-fast') + 100)
    update()
    return
  }
  if (typeof document.startViewTransition !== 'function') {
    update()
    return
  }

  // Latest wins: the running transition jumps to its end state; the new one starts from there.
  running?.skipTransition()
  nameElements(ids)
  root.setAttribute(ATTRIBUTE, 'morph')
  const transition = document.startViewTransition(() => {
    flushSync(update)
    nameElements(ids)
  })
  running = transition
  // A skipped or failed transition rejects these; the state change itself is not affected.
  transition.ready.catch(() => undefined)
  transition.updateCallbackDone.catch(() => undefined)
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      // A newer transition owns the names and the attribute now.
      if (running !== transition) return
      running = null
      clearNames()
      root.removeAttribute(ATTRIBUTE)
    })
}
