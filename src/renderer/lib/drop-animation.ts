import type { DropAnimation, DropAnimationFunction } from '@dnd-kit/core'

// The drop of a dragged task row (card 4.8). The drag overlay travels from where it was let go into
// the slot the row now has. The new order must already be rendered when the drop starts (AppShell
// writes it into the cache with commitSync before it ends the drag). The slot is measured with the
// transform and transition dnd-kit may still have on the row taken off, so a layout animation of
// the row itself cannot make the overlay aim at a point in between. While the overlay travels the
// real row is hidden and the overlay settles from the lifted scale to 1. Under reduced motion there
// is no travel and no lift: the overlay is gone at once and the row shows.

const LIFTED_SCALE = '1.02'

export interface DropTiming {
  /** ms: the fade.base token. */
  duration: number
  /** An easing: the enter curve. */
  easing: string
}

/** The slot of `row`: its box with any inline transform and transition taken off for the measurement. */
function slotOf(row: HTMLElement): DOMRect {
  const { transform, transition } = row.style
  row.style.transition = 'none'
  row.style.transform = 'none'
  const rect = row.getBoundingClientRect()
  row.style.transform = transform
  row.style.transition = transition
  return rect
}

export function taskDropAnimation({ duration, easing }: DropTiming, reduced: boolean): DropAnimation {
  if (reduced) return { duration: 0, easing, sideEffects: null }

  const travel: DropAnimationFunction = ({ active, dragOverlay, transform }) => {
    const row = active.node
    const slot = slotOf(row)
    // The overlay's translation puts it where it was let go; the row's slot is `delta` away from the
    // overlay's box, so the translation that lands it there is the current one minus the delta.
    const dx = dragOverlay.rect.left - slot.left
    const dy = dragOverlay.rect.top - slot.top
    const to = { x: transform.x - dx, y: transform.y - dy }
    if (Math.abs(to.x - transform.x) < 0.5 && Math.abs(to.y - transform.y) < 0.5) return

    const hidden = row.style.opacity
    row.style.opacity = '0'
    const lifted = dragOverlay.node.querySelector<HTMLElement>('.vicu-lift')
    if (lifted && typeof lifted.animate === 'function') {
      lifted.animate([{ scale: LIFTED_SCALE }, { scale: '1' }], { duration, easing, fill: 'forwards' })
    }
    const animation = dragOverlay.node.animate(
      [
        { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` },
        { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
      ],
      { duration, easing, fill: 'forwards' },
    )
    return new Promise<void>((resolve) => {
      const done = () => {
        row.style.opacity = hidden
        resolve()
      }
      animation.onfinish = done
      animation.oncancel = done
    })
  }
  return travel
}
