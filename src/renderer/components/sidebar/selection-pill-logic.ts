// The slide of the sidebar selection pill (card 4.6), kept pure so it can be tested.

export interface PillBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * How long a pill that went away is remembered as the start of the next one. Not a motion: the old
 * pill unmounts and the new one mounts in the same commit, so anything older than this is a different
 * navigation and does not slide.
 */
export const PILL_REMEMBER_MS = 300

/**
 * The transform that puts the new pill (`to`) where the old one (`from`) was: a translation of its
 * top-left corner and a scale, with transform-origin at the top left. Null when it did not move.
 */
export function pillSlide(from: PillBox, to: PillBox): { dx: number; dy: number; sx: number; sy: number } | null {
  if (to.width <= 0 || to.height <= 0) return null
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / to.width
  const sy = from.height / to.height
  const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5 || Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005
  return moved ? { dx, dy, sx, sy } : null
}
