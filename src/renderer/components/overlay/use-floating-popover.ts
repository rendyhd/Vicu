import { useLayoutEffect, useRef, type RefObject } from 'react'
import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from '@floating-ui/dom'
import { POPOVER_EDGE, POPOVER_GAP, popoverMaxHeight } from './popover-logic'
import { afterPress } from './pointer-press'

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
 * popover from the top layer without events). Moving it in the document drops it just as silently,
 * and a list does that when it sorts a row of an open popover further down (a later date, say). It
 * is still open as far as anyone knows, so it opens again before the next paint.
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
    // A context menu on macOS mounts while the right button is still down; shown now, the release
    // would light-dismiss it at once. It opens on the release instead (`pointer-press.ts`).
    let stop = () => {}
    let opened = false
    const cancelOpen = afterPress(() => {
      if (!el.matches(':popover-open')) el.showPopover()
      stop = autoUpdate(anchor, el, update)
      opened = true
    })

    // A hide with events was meant: light dismiss, Escape, the code. Only a move has none.
    let closing = false
    const onBeforeToggle = (event: Event) => {
      closing = (event as ToggleEvent).newState === 'closed'
    }
    let lastFocus: HTMLElement | null = null
    const onFocusIn = (event: FocusEvent) => {
      lastFocus = event.target as HTMLElement
    }
    el.addEventListener('beforetoggle', onBeforeToggle)
    el.addEventListener('focusin', onFocusIn)
    const moves = new MutationObserver(() => {
      if (!opened || closing || !el.isConnected || el.matches(':popover-open')) return
      // Back as it was, so without the opening fade and with focus where it was.
      el.style.transition = 'none'
      el.showPopover()
      el.getBoundingClientRect()
      el.style.transition = ''
      if (lastFocus && el.contains(lastFocus)) lastFocus.focus({ preventScroll: true })
      update()
    })
    moves.observe(el.ownerDocument.body, { childList: true, subtree: true })

    return () => {
      alive = false
      moves.disconnect()
      el.removeEventListener('beforetoggle', onBeforeToggle)
      el.removeEventListener('focusin', onFocusIn)
      cancelOpen()
      stop()
      for (const invoker of invokers) {
        invoker.popoverTargetElement = null
        invoker.removeAttribute('popovertargetaction')
      }
    }
  }, [anchorRef, floatingRef, placement])
}
