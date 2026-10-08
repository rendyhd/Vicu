import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { playRowClose } from '@/lib/row-close'
import { completionHold, useCompletionHoldStore } from '@/stores/completion-hold-store'

/**
 * Closes the row of a completed task when its hold ends: it fades and its height closes (a fade only
 * under reduced motion), then the completed-tasks entry is removed so the row leaves the list. Undo
 * while it is closing cancels the animation and the row is back at full height.
 */
export function useCompletionCollapse(taskId: number, rowRef: RefObject<HTMLElement | null>): void {
  const closing = useCompletionHoldStore((s) => s.collapsing.has(taskId))
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    if (!closing) return
    const el = rowRef.current
    if (!el || typeof el.animate !== 'function') {
      completionHold.finishCollapse(taskId)
      return
    }
    const animation = playRowClose(el, reduced)
    let live = true
    animation.finished.then(
      () => {
        if (live) completionHold.finishCollapse(taskId)
      },
      () => {}
    )
    return () => {
      live = false
      animation.cancel()
    }
  }, [closing, reduced, taskId, rowRef])
}
