// The Plan screen's timeline: where things sit on the wall-clock grid and what a gesture means.
// Pure, the clock is passed in. Overlap columns and the gesture model come from Anton Parkhomenko's
// day calendar (rendyhd/Vicu#58), moved onto the task's own start_date and end_date (contract 16).

import {
  addLocalDays,
  isDateOnly,
  isNoDueDate,
  isOverdue,
  localDateOf,
  startOfLocalDay,
  type LocalDate,
} from '../../shared/due-dates'
import {
  BLOCK_STEP_MINUTES,
  MAX_BLOCK_MINUTES,
  blockOf,
  minutesOfDay,
  type BlockFields,
  type TimeBlock,
} from '../../shared/time-blocks'

export const DAY_MINUTES = 24 * 60
/** An hour on the grid; one pixel is one minute. */
export const HOUR_HEIGHT_PX = 60
export const PX_PER_MINUTE = HOUR_HEIGHT_PX / 60
/** A short block is drawn this tall so its title can be read, when the next block leaves the room. */
export const MIN_ITEM_MINUTES = 22
export const DRAG_THRESHOLD_PX = 4
/** How close to a block's top or bottom a press grabs that edge. */
export const EDGE_GRAB_PX = 7

export const NULL_DATE_FILTER = '0001-01-01T00:00:00Z'

// --- What a day shows ---------------------------------------------------------------------------

export interface PlanTaskFields extends BlockFields {
  id: number
  done?: boolean
  due_date?: string | null
}

export interface PlacedBlock<T> {
  task: T
  block: TimeBlock
  startMinute: number
  endMinute: number
  /** How tall it is drawn: its length, or a little more when it is short and the room is free. */
  drawnMinutes: number
  /** Which side-by-side column it takes where blocks overlap, and how many there are. */
  column: number
  columnCount: number
}

function endMinuteOf(block: TimeBlock): number {
  const nextMidnight = new Date(block.start.getFullYear(), block.start.getMonth(), block.start.getDate() + 1)
  return block.end.getTime() === nextMidnight.getTime() ? DAY_MINUTES : minutesOfDay(block.end)
}

/** Greedy interval partitioning; a connected group of overlaps shares its largest column count. */
export function layoutOverlaps<B extends { startMinute: number; endMinute: number; column: number; columnCount: number }>(
  items: readonly B[],
  tieBreak: (a: B, b: B) => number = () => 0,
): B[] {
  const sorted = [...items].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || tieBreak(a, b),
  )
  const result: B[] = []
  let group: B[] = []
  let columnEnds: number[] = []
  let groupEnd = -1
  const flush = () => {
    result.push(...group.map((item) => ({ ...item, columnCount: columnEnds.length })))
    group = []
    columnEnds = []
  }
  for (const item of sorted) {
    if (item.startMinute >= groupEnd) flush()
    let column = columnEnds.findIndex((end) => end <= item.startMinute)
    if (column === -1) column = columnEnds.length
    columnEnds[column] = item.endMinute
    group.push({ ...item, column })
    groupEnd = Math.max(...columnEnds)
  }
  flush()
  return result
}

/** The blocks that start on `day`, laid out side by side where they overlap. */
export function dayBlocks<T extends PlanTaskFields>(tasks: readonly T[], day: LocalDate): PlacedBlock<T>[] {
  const placed: PlacedBlock<T>[] = []
  for (const task of tasks) {
    const block = blockOf(task)
    if (!block || block.day !== day) continue
    const startMinute = minutesOfDay(block.start)
    const endMinute = endMinuteOf(block)
    placed.push({ task, block, startMinute, endMinute, drawnMinutes: endMinute - startMinute, column: 0, columnCount: 1 })
  }
  // Columns go by the real times, so a block that starts where a short one ends sits under it.
  return layoutOverlaps(placed, (a, b) => a.task.id - b.task.id).map((item) => {
    const room = placed.reduce(
      (nearest, other) => (other.startMinute >= item.endMinute ? Math.min(nearest, other.startMinute) : nearest),
      DAY_MINUTES,
    ) - item.startMinute
    return { ...item, drawnMinutes: Math.max(item.endMinute - item.startMinute, Math.min(MIN_ITEM_MINUTES, room)) }
  })
}

/** A calendar event on a day's grid (proof of concept), clipped to that day. */
export interface PlacedEvent<E> {
  event: E
  startMinute: number
  endMinute: number
  drawnMinutes: number
  column: number
  columnCount: number
}

/**
 * Blocks and calendar events share one overlap layout, so neither hides the other. Events take the
 * left columns where they tie: they were there first, a block is what you place around them.
 */
export function layoutWithEvents<T extends PlanTaskFields, E>(
  blocks: readonly PlacedBlock<T>[],
  events: readonly { event: E; startMinute: number; endMinute: number }[],
): { blocks: PlacedBlock<T>[]; events: PlacedEvent<E>[] } {
  if (events.length === 0) return { blocks: [...blocks], events: [] }
  type Item = { startMinute: number; endMinute: number; column: number; columnCount: number; order: number; block?: PlacedBlock<T>; event?: { event: E; startMinute: number; endMinute: number } }
  const items: Item[] = [
    ...events.map((event, index) => ({ startMinute: event.startMinute, endMinute: event.endMinute, column: 0, columnCount: 1, order: index, event })),
    ...blocks.map((block, index) => ({ startMinute: block.startMinute, endMinute: block.endMinute, column: 0, columnCount: 1, order: events.length + index, block })),
  ]
  const laid = layoutOverlaps(items, (a, b) => a.order - b.order)
  const outBlocks: PlacedBlock<T>[] = []
  const outEvents: PlacedEvent<E>[] = []
  for (const item of laid) {
    if (item.block) {
      outBlocks.push({ ...item.block, column: item.column, columnCount: item.columnCount })
    } else if (item.event) {
      const length = item.endMinute - item.startMinute
      outEvents.push({ ...item.event, drawnMinutes: Math.max(length, Math.min(MIN_ITEM_MINUTES, DAY_MINUTES - item.startMinute)), column: item.column, columnCount: item.columnCount })
    }
  }
  return { blocks: outBlocks, events: outEvents }
}

/** An open task with a time-of-day due date on `day` and no block: a marker at that time (section 16.7). */
export function dayMarkers<T extends PlanTaskFields>(tasks: readonly T[], day: LocalDate): { task: T; minute: number }[] {
  const markers: { task: T; minute: number }[] = []
  for (const task of tasks) {
    if (task.done || blockOf(task) || isNoDueDate(task.due_date)) continue
    const due = task.due_date as string
    if (isDateOnly(due) || localDateOf(due) !== day) continue
    markers.push({ task, minute: minutesOfDay(new Date(due)) })
  }
  return markers.sort((a, b) => a.minute - b.minute || a.task.id - b.task.id)
}

/** How far a marker reaches above and below its time, in minutes. */
const MARKER_REACH_MINUTES = 10

/**
 * Whether a due-time marker lies over a block of its day. It then keeps to the right of the column,
 * above the block: a block's title is at its left, and neither may hide the other.
 */
export function markerOverBlock(minute: number, blocks: readonly { startMinute: number; drawnMinutes: number }[]): boolean {
  return blocks.some(
    (block) => minute + MARKER_REACH_MINUTES > block.startMinute && minute - MARKER_REACH_MINUTES < block.startMinute + block.drawnMinutes,
  )
}

/** A day's tasks without a time, the row above its timeline on every view (section 16.4). */
export { dayTopRow } from '../../shared/time-blocks'

/**
 * The left panel's first list: what is on the selected day without a time. Overdue tasks count when
 * the day is today, and a task with a due time is on the timeline already. `held` keeps a task the
 * completion hold is still showing.
 */
export function dayWithoutTime<T extends PlanTaskFields>(
  tasks: readonly T[],
  day: LocalDate,
  now: Date,
  isHeld: (task: T) => boolean = () => false,
): T[] {
  const today = localDateOf(now.toISOString())
  return tasks.filter((task) => {
    if (task.done && !isHeld(task)) return false
    if (isNoDueDate(task.due_date) || blockOf(task)?.day === day) return false
    const due = task.due_date as string
    if (localDateOf(due) === day) return isDateOnly(due)
    return day === today && isOverdue(due, now)
  })
}

/** Minutes of open blocks that day, with overlaps counted once each (the header's "45m planned"). */
export function plannedMinutes<T extends PlanTaskFields>(tasks: readonly T[], day: LocalDate): number {
  return tasks.reduce((sum, task) => {
    if (task.done) return sum
    const block = blockOf(task)
    return block && block.day === day ? sum + block.minutes : sum
  }, 0)
}

/** "45m", "1h", "4h 20m". */
export function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// --- The request ---------------------------------------------------------------------------------

/**
 * One server filter for a view: a block starting in the range (done ones too, they stay on the
 * timeline), an open task due in it, and overdue tasks when today is shown.
 */
export function planRangeFilter(days: readonly LocalDate[], today: LocalDate): string {
  const from = startOfLocalDay(days[0]).toISOString()
  const to = startOfLocalDay(addLocalDays(days[days.length - 1], 1)).toISOString()
  const due = `(due_date >= '${from}' && due_date < '${to}')`
  const overdue = days.includes(today)
    ? ` || (due_date != '${NULL_DATE_FILTER}' && due_date < '${startOfLocalDay(today).toISOString()}')`
    : ''
  return `(start_date >= '${from}' && start_date < '${to}') || (done = false && (${due}${overdue}))`
}

// --- Gestures ------------------------------------------------------------------------------------

export type GestureMode = 'move' | 'start' | 'end' | 'draw'

export interface GestureRange {
  startMinute: number
  endMinute: number
}

/** The nearest 15-minute line. */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** Move a stretch by the pointer's travel: it lands on a 15-minute line and stays inside the day. */
export function movedRange(range: GestureRange, deltaMinutes: number): GestureRange {
  const length = range.endMinute - range.startMinute
  const startMinute = clamp(snapMinutes(range.startMinute + deltaMinutes), 0, DAY_MINUTES - length)
  return { startMinute, endMinute: startMinute + length }
}

/** The top edge to `minute`: at least one step, at most 12 hours. The end stays. */
export function startEdgeRange(range: GestureRange, minute: number): GestureRange {
  const low = Math.max(0, range.endMinute - MAX_BLOCK_MINUTES)
  return { startMinute: clamp(snapMinutes(minute), low, range.endMinute - BLOCK_STEP_MINUTES), endMinute: range.endMinute }
}

/** The bottom edge to `minute`: at least one step, at most 12 hours, no later than the midnight. */
export function endEdgeRange(range: GestureRange, minute: number): GestureRange {
  const high = Math.min(DAY_MINUTES, range.startMinute + MAX_BLOCK_MINUTES)
  return { startMinute: range.startMinute, endMinute: clamp(snapMinutes(minute), range.startMinute + BLOCK_STEP_MINUTES, high) }
}

/** Drawing from `anchor` to `minute`, in either direction. */
export function drawnRange(anchor: number, minute: number): GestureRange {
  const a = clamp(snapMinutes(anchor), 0, DAY_MINUTES - BLOCK_STEP_MINUTES)
  const b = clamp(snapMinutes(minute), 0, DAY_MINUTES)
  if (b >= a) {
    return { startMinute: a, endMinute: clamp(b, a + BLOCK_STEP_MINUTES, Math.min(DAY_MINUTES, a + MAX_BLOCK_MINUTES)) }
  }
  return { startMinute: Math.max(b, a - MAX_BLOCK_MINUTES), endMinute: a }
}

/** Where a press grabs a block of `height` pixels: its edges, else the whole block. A short block keeps a middle to move it by. */
export function grabMode(offsetY: number, height: number, canResize: boolean): GestureMode {
  if (!canResize) return 'move'
  const edge = Math.min(EDGE_GRAB_PX, height / 4)
  if (offsetY < edge) return 'start'
  if (height - offsetY < edge) return 'end'
  return 'move'
}

/** The day column under a horizontal position, or null outside the columns. */
export function dayAtX(days: readonly LocalDate[], x: number, left: number, width: number): LocalDate | null {
  if (width <= 0 || x < left || x >= left + width) return null
  return days[Math.min(days.length - 1, Math.floor(((x - left) / width) * days.length))]
}

/** The minute under a vertical position, inside the day. */
export function minuteAtY(y: number, gridTop: number): number {
  return clamp((y - gridTop) / PX_PER_MINUTE, 0, DAY_MINUTES)
}

/** A block cannot be placed on a past day (section 16.2). */
export function canPlaceOn(day: LocalDate, today: LocalDate): boolean {
  return day >= today
}

/** Where the scroller opens: an hour before now on today, the work hours' start on another day. */
export function openingMinute(day: LocalDate, now: Date, today: LocalDate, workStart: number): number {
  return day === today ? Math.max(0, minutesOfDay(now) - 60) : workStart
}
