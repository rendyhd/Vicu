// The priority mark: the shapes of design-tokens-v1.json `priority`, drawn the same way in the main
// window (PriorityMark.tsx) and in Quick View (a string of SVG). Pure: no DOM, no Electron.
//
// Priority 0 shows nothing. 1 to 3 are one to three ascending bars (the unused slots stay as a faint
// outline of the three, so the level reads from the count), 4 and 5 are a filled square with a "!"
// cut out of it. The mark is drawn with currentColor; the colour comes from the priority role.
// A mark never carries meaning alone: it has a text name (the same spoken names as Android).

export type PriorityMarkKind = 'bars-1' | 'bars-2' | 'bars-3' | 'square-bang'
export type PriorityRole = 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'

export interface PriorityMarkSpec {
  kind: PriorityMarkKind
  role: PriorityRole
  /** The CSS variable of the role (tokens.css). */
  cssVar: string
  /** The spoken name. */
  name: string
}

const LEVELS: Record<number, PriorityMarkSpec> = {
  1: { kind: 'bars-1', role: 'priority.low', cssVar: '--priority-low', name: 'Low priority' },
  2: { kind: 'bars-2', role: 'priority.medium', cssVar: '--priority-medium', name: 'Medium priority' },
  3: { kind: 'bars-3', role: 'priority.high', cssVar: '--priority-high', name: 'High priority' },
  4: { kind: 'square-bang', role: 'priority.urgent', cssVar: '--priority-urgent', name: 'Urgent priority' },
  5: { kind: 'square-bang', role: 'priority.urgent', cssVar: '--priority-urgent', name: 'Do now priority' },
}

/** The mark of a priority, or null when nothing is shown (0, out of range, not a whole number). */
export function priorityMark(priority: number | null | undefined): PriorityMarkSpec | null {
  if (typeof priority !== 'number' || !Number.isInteger(priority)) return null
  return LEVELS[priority] ?? null
}

/** The side of the square viewBox every mark is drawn in. */
export const PRIORITY_MARK_VIEWBOX = 14

export interface PriorityBar {
  x: number
  y: number
  width: number
  height: number
  /** Whether the bar belongs to the level (false: the faint slot). */
  on: boolean
}

const BAR_SLOTS = [
  { x: 1.5, y: 8, height: 5 },
  { x: 5.5, y: 5, height: 8 },
  { x: 9.5, y: 2, height: 11 },
] as const
const BAR_WIDTH = 3

/** The three bar slots of a bars mark, with `on` set for the ones the level fills. */
export function priorityBars(kind: PriorityMarkKind): PriorityBar[] {
  const filled = kind === 'bars-1' ? 1 : kind === 'bars-2' ? 2 : kind === 'bars-3' ? 3 : 0
  return BAR_SLOTS.map((slot, i) => ({ ...slot, width: BAR_WIDTH, on: i < filled }))
}

/** Opacity of the unused slots of a bars mark. */
export const PRIORITY_SLOT_OPACITY = 0.28

/** The urgent mark: a rounded square with the "!" (a bar and a dot) cut out with the even-odd rule. */
export const SQUARE_BANG_PATH =
  'M3 1h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z' +
  'M6.25 3.25h1.5v5h-1.5z' +
  'M6.1 10.5a.9.9 0 1 0 1.8 0 .9.9 0 1 0-1.8 0z'

/**
 * The mark as an SVG string for pages without React (Quick View). The svg has role="img" and the
 * spoken name; it is empty for a priority that shows nothing. Only fixed values go into the string.
 */
export function priorityMarkSvg(priority: number | null | undefined, sizePx = 14): string {
  const spec = priorityMark(priority)
  if (!spec) return ''
  const size = Math.round(sizePx)
  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${PRIORITY_MARK_VIEWBOX} ${PRIORITY_MARK_VIEWBOX}" fill="currentColor" ` +
    `role="img" aria-label="${spec.name}" data-priority-mark="${spec.kind}">`
  if (spec.kind === 'square-bang') {
    return `${open}<path fill-rule="evenodd" d="${SQUARE_BANG_PATH}"/></svg>`
  }
  const bars = priorityBars(spec.kind)
    .map((b) => {
      const dim = b.on ? '' : ` fill-opacity="${PRIORITY_SLOT_OPACITY}"`
      return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="1"${dim}/>`
    })
    .join('')
  return `${open}${bars}</svg>`
}
