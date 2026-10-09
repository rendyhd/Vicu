import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { flushSync } from 'react-dom'

/** The scheduler the notify manager runs now (it has no getter): the library default until a commit swaps it. */
let scheduler: Parameters<typeof notifyManager.setScheduler>[0] = defaultScheduler

/**
 * Runs `update` (a change of the query cache) and renders its effect before returning. The query
 * library tells its observers on a timer, so a cache write is on screen a frame or two later; a drop
 * needs the new order in the DOM in the same tick, or the rows are drawn in their old order for a
 * moment (the "snap back") and the drop animation measures the old slot. Only the writes inside
 * `update` are notified at once; the scheduler that was set before is put back afterwards.
 */
export function commitSync(update: () => void): void {
  const previous = scheduler
  scheduler = (callback) => callback()
  notifyManager.setScheduler(scheduler)
  try {
    flushSync(update)
  } finally {
    scheduler = previous
    notifyManager.setScheduler(previous)
  }
}
