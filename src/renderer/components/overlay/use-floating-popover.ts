import { useLayoutEffect, useRef, type RefObject } from 'react'
import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from '@floating-ui/dom'
import { POPOVER_EDGE, POPOVER_GAP, popoverMaxHeight } from './popover-logic'

interface FloatingPopoverOptions {
  placement: Placement
  /** Other buttons that open and close the same popover; a press on them is not an outside press. */
  invokedBy?: RefObject<HTMLElement | null>[]
  /** Called once, after the first position is applied and the popover is visible. */
  onPlaced?: () => void
}

/**
 * Puts `floating` (an element with a `popover` attribute) into the top layer and keeps it next to
 * `anchor`: below or above it as the space allows (flip), inside the window (shift) and no taller
 * than the room the placement leaves (size; the popover scrolls inside). The top layer is what
 * stops the card, the list and the content area from clipping it.
 *
 * Mounting the element opens the popover; unmounting it closes it (the browser drops a removed
 * popover from the top layer without events).
 */
export function useFloatingPopover(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  { placement, invokedBy, onPlaced }: FloatingPopoverOptions,
): void {
  const onPlacedRef = useRef(onPlaced)
  onPlacedRef.current = onPlaced
  const invokedByRef = useRef(invokedBy)
  invokedByRef.current = invokedBy

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const el = floatingRef.current
    if (!anchor || !el) return

    // Hidden until the first position is known, so it never shows at the browser's default spot.
    el.style.visibility = 'hidden'
    if (!el.matches(':popover-open')) el.showPopover()

    // A pointer press on the anchor of an open popover must not count as an outside press: the
    // anchor's own click toggles the popover, and light dismiss would close it first, so the click
    // would open it again. A popover invoker is exempt from light dismiss. The action `show` does
    // nothing natively (the popover is already open when the click's default action runs); the
    // click handler of the anchor does the closing.
    const invokers = [anchor, ...(invokedByRef.current ?? []).map((ref) => ref.current)].filter(
      (candidate): candidate is HTMLButtonElement => candidate instanceof HTMLButtonElement,
    )
    for (const invoker of invokers) {
      invoker.popoverTargetElement = el
      invoker.popoverTargetAction = 'show'
    }

    let alive = true
    let placed = false
    const update = () => {
      // Measure at natural size: a max-height left from the last pass would make a popover that
      // does not fit below look small enough to fit, and it would stay there.
      el.style.maxHeight = ''
      el.style.maxWidth = ''
      void computePosition(anchor, el, {
        strategy: 'fixed',
        placement,
        middleware: [
          offset(POPOVER_GAP),
          flip({ padding: POPOVER_EDGE, fallbackAxisSideDirection: 'end' }),
          shift({ padding: POPOVER_EDGE }),
          size({
            padding: POPOVER_EDGE,
            apply({ availableHeight, availableWidth }) {
              el.style.maxHeight = `${popoverMaxHeight(availableHeight)}px`
              el.style.maxWidth = `${Math.max(0, Math.floor(availableWidth))}px`
            },
          }),
        ],
      }).then(({ x, y, placement: placedAt }) => {
        if (!alive) return
        el.style.left = `${x}px`
        el.style.top = `${y}px`
        el.dataset.placement = placedAt
        if (!placed) {
          placed = true
          el.style.visibility = ''
          onPlacedRef.current?.()
        }
      })
    }
    const stop = autoUpdate(anchor, el, update)

    return () => {
      alive = false
      stop()
      for (const invoker of invokers) {
        invoker.popoverTargetElement = null
        invoker.removeAttribute('popovertargetaction')
      }
    }
  }, [anchorRef, floatingRef, placement])
}
