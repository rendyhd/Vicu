import type { DropAnimation, DropAnimationFunction } from '@dnd-kit/core'

// The drop of a dragged task row (card 4.8). A reorder: the drag overlay travels from where it was let
// go into the slot the row now has. The new order must already be rendered when the drop starts
// (AppShell writes it into the cache with commitSync before it ends the drag). The slot is measured
// with the transform and transition dnd-kit may still have on the row taken off, so a layout animation
// of the row itself cannot make the overlay aim at a point in between. While the overlay travels the
// real row is hidden and the overlay settles from the lifted scale to 1 and widens to the row.
//
// A task that went somewhere else (another project, a label, the Plan timeline) has no slot here to
// go back to: its row is about to leave, so the overlay lands instead. It goes into the target,
// shrinking and fading, with the row hidden so it is not drawn again before the list updates.
//
// Under reduced motion there is no travel, no lift and no scale: a reorder is gone at once and the row
// shows, a landing only fades where it was let go.

const LIFTED_SCALE = '1.02'
const LANDED_SCALE = '0.6'

export interface DropTiming {
  /** ms: the fade.base token. */
  duration: number
  /** An easing: the enter curve. */
  easing: string
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface DropLanding {
  /** Where the overlay goes; null when it fades where it was let go (a time on the Plan timeline). */
  into: Box | null
  /** The row stays where it is and is not hidden (a label added to a task). */
  keepsRow?: boolean
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

/** The translation that puts the centre of `from` on the centre of `to`. */
export function centreToCentre(from: Box, to: Box): { x: number; y: number } {
  return {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
  }
}

/**
 * @param takeLanding What the drop that just happened asks for: null for the journey back into the
 * row's slot. Read once per drop, when the animation starts.
 */
export function taskDropAnimation(
  { duration, easing }: DropTiming,
  reduced: boolean,
  takeLanding: () => DropLanding | null = () => null,
): DropAnimation {
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
    // The overlay is a chip while it follows the pointer; it arrives as wide as the row.
    const chip = dragOverlay.node.firstElementChild
    if (chip && Math.abs(slot.width - dragOverlay.rect.width) > 1) {
      chip.animate(
        [
          { width: `${dragOverlay.rect.width}px`, maxWidth: 'none' },
          { width: `${slot.width}px`, maxWidth: 'none' },
        ],
        { duration, easing, fill: 'forwards' },
      )
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

  const land = (
    { active, dragOverlay, transform }: Parameters<DropAnimationFunction>[0],
    landing: DropLanding,
  ): Promise<void> | void => {
    const row = active.node
    const hidden = row.style.opacity
    if (!landing.keepsRow) row.style.opacity = '0'
    const chip = dragOverlay.node.firstElementChild ?? dragOverlay.node

    if (!reduced && landing.into) {
      const by = centreToCentre(dragOverlay.rect, landing.into)
      dragOverlay.node.animate(
        [
          { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` },
          { transform: `translate3d(${transform.x + by.x}px, ${transform.y + by.y}px, 0)` },
        ],
        { duration, easing, fill: 'forwards' },
      )
      chip.animate([{ scale: '1' }, { scale: LANDED_SCALE }], { duration, easing, fill: 'forwards' })
    }
    // The fade runs evenly: on the enter curve it would be over before the chip arrives.
    const fade = chip.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' })
    return new Promise<void>((resolve) => {
      const done = () => {
        if (!landing.keepsRow) {
          row.style.opacity = hidden
          // In a list the task still belongs to (Today, after a move to another project) it comes back.
          if (row.isConnected) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing })
        }
        resolve()
      }
      fade.onfinish = done
      fade.oncancel = done
    })
  }

  return (args) => {
    const landing = takeLanding()
    if (landing) return land(args, landing)
    if (reduced) return
    return travel(args)
  }
}
