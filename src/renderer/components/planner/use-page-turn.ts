import { useEffect, useRef, type RefObject } from 'react'

/** How long the pointer rests on Back or Forward during a drag before the page turns. */
export const PAGE_TURN_HOLD_MS = 500

export type TurnDirection = -1 | 1

/** The Day view's Back and Forward buttons, which turn the page while a drag rests on them. */
export interface PageTurn {
  prevRef: RefObject<HTMLElement | null>
  nextRef: RefObject<HTMLElement | null>
  /** False when the page would land on a day a block cannot be placed on (a past day). */
  canTurn: (direction: TurnDirection) => boolean
  onTurn: (direction: TurnDirection) => void
  /** The button the drag rests on, for its highlight; null when it leaves. */
  onHover: (direction: TurnDirection | null) => void
}

const inside = (element: HTMLElement | null | undefined, x: number, y: number): boolean => {
  const box = element?.getBoundingClientRect()
  return !!box && box.width > 0 && x >= box.left && x < box.right && y >= box.top && y < box.bottom
}

/** Which page-turn button is under a point, if any. */
export function turnAt(turn: PageTurn | undefined, x: number, y: number): TurnDirection | null {
  if (!turn) return null
  if (inside(turn.prevRef.current, x, y)) return -1
  if (inside(turn.nextRef.current, x, y)) return 1
  return null
}

/**
 * While a block or a task is dragged, resting the pointer on Back or Forward for `PAGE_TURN_HOLD_MS`
 * turns the page by one day, again for each further rest, and the drag carries on over the new day.
 * The buttons are read by their boxes: the drag holds the pointer (pointer capture, or dnd-kit's
 * `html[data-dragging]`), so they get no hover of their own.
 */
export function usePageTurnWhileDragging(dragging: boolean, turn: PageTurn | undefined): void {
  const latest = useRef(turn)
  latest.current = turn
  const enabled = dragging && !!turn

  useEffect(() => {
    if (!enabled) return
    let armed: TurnDirection | null = null
    let timer = 0

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = latest.current
        if (armed === null || !current) return
        if (!current.canTurn(armed)) {
          current.onHover(null)
          return
        }
        current.onTurn(armed)
        schedule()
      }, PAGE_TURN_HOLD_MS)
    }
    const arm = (direction: TurnDirection | null) => {
      if (direction === armed) return
      window.clearTimeout(timer)
      armed = direction
      latest.current?.onHover(direction !== null && latest.current.canTurn(direction) ? direction : null)
      if (direction !== null) schedule()
    }
    const move = (event: PointerEvent) => arm(turnAt(latest.current, event.clientX, event.clientY))

    window.addEventListener('pointermove', move, true)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.clearTimeout(timer)
      if (armed !== null) latest.current?.onHover(null)
    }
  }, [enabled])
}
