import { useState } from 'react'

/**
 * True from the moment a task flips from open to done while its row is on screen, until it is open
 * again. The checkbox and the title play their completion animation only then: a row that is
 * already done when it appears (the Logbook, a refetch) is just drawn done. The flip is read during
 * render, so the first frame of the done state already carries the animation classes.
 */
export function useCompletionPlay(done: boolean): boolean {
  const [previous, setPrevious] = useState(done)
  const [played, setPlayed] = useState(false)
  if (previous !== done) {
    setPrevious(done)
    setPlayed(done)
  }
  return played
}
