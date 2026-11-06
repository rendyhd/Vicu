import type { ClientRect, Modifier } from '@dnd-kit/core'

// Where a dragged task or project is drawn: a chip below and to the right of the pointer, the way an
// operating system draws a drag image, so the row under the pointer (a project in the sidebar, a drop
// line) stays visible. This is a modifier of DragOverlay only, so it moves the picture and nothing the
// drag does: the drop targets go by the pointer (AppShell's collision detection, rowBandAtPointer).

const GAP_X = 12
const GAP_Y = 14
/** Room kept to the edge of the window when the chip would run off it. */
const EDGE = 8

interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

/**
 * The top left of the chip for a pointer at `pointer`. Past the right edge of the window it slides
 * left, past the bottom edge it goes above the pointer.
 */
export function besidePointer(pointer: Point, chip: Size | null, view: Size | null): Point {
  let x = pointer.x + GAP_X
  let y = pointer.y + GAP_Y
  if (chip && view) {
    if (x + chip.width > view.width - EDGE) x = Math.max(EDGE, view.width - EDGE - chip.width)
    if (y + chip.height > view.height - EDGE) y = pointer.y - GAP_Y - chip.height
  }
  return { x, y }
}

function pointerOf(event: Event | null): Point | null {
  if (!event || !('clientX' in event)) return null
  const { clientX, clientY } = event as PointerEvent
  return { x: clientX, y: clientY }
}

/** Which drags are drawn beside the pointer; sections and custom lists stay rows that reorder in place. */
const BESIDE_POINTER_TYPES = new Set(['task', 'project'])

// DragOverlay places itself from the row's first measured rect and never measures it again, while
// activeNodeRect follows the row (a list scrolling under the drag). The offset has to use the same one.
let measuredFor: Event | null = null
let rowAtStart: ClientRect | null = null

export const overlayBesidePointer: Modifier = ({ activatorEvent, active, activeNodeRect, overlayNodeRect, transform, windowRect }) => {
  const type = active?.data.current?.type as string | undefined
  if (!type || !BESIDE_POINTER_TYPES.has(type)) return transform
  const start = pointerOf(activatorEvent)
  if (!start || !activeNodeRect) return transform
  if (measuredFor !== activatorEvent) {
    measuredFor = activatorEvent
    rowAtStart = activeNodeRect
  }
  const row = rowAtStart ?? activeNodeRect
  const pointer = { x: start.x + transform.x, y: start.y + transform.y }
  const at = besidePointer(pointer, overlayNodeRect, windowRect)
  return { ...transform, x: at.x - row.left, y: at.y - row.top }
}

/**
 * A row-shaped box at the pointer's height, in the column the row came from: what a task drag
 * intersects when the pointer is over no drop target (beside the list, in a gap), so a drop just off
 * the list still lands by height. The chip beside the pointer would miss the list there.
 */
export function rowBandAtPointer(row: ClientRect, pointer: Point): ClientRect {
  const top = pointer.y - row.height / 2
  return { ...row, top, bottom: top + row.height }
}
