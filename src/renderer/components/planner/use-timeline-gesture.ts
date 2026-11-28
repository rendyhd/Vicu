import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  DRAG_THRESHOLD_PX,
  canPlaceOn,
  dayAtX,
  drawnRange,
  endEdgeRange,
  minuteAtY,
  movedRange,
  startEdgeRange,
  type GestureMode,
  type GestureRange,
} from '@/lib/planner-timeline'
import type { Task } from '@/lib/vikunja-types'
import type { LocalDate } from '../../../shared/due-dates'
import type { CalendarEvent } from '../../../shared/calendar-events'

const SCROLL_EDGE_PX = 32
const MAX_SCROLL_PX_PER_SECOND = 600

/** What a press grabbed: a block or a marker with its real times; nothing when drawing. */
export interface TaskGestureItem {
  kind: 'task'
  task: Task
  day: LocalDate
  range: GestureRange
  hasBlock: boolean
}

/**
 * One of your own Events, on the day it starts (contract 20.7): moved and its edges dragged like a
 * block, but never onto the task panel or a day's top row.
 */
export interface EventGestureItem {
  kind: 'event'
  event: CalendarEvent
  day: LocalDate
  range: GestureRange
}

export type GestureItem = TaskGestureItem | EventGestureItem

export type GestureTarget =
  | { kind: 'grid'; day: LocalDate; range: GestureRange }
  /** Over the left panel: the block goes back to the list. */
  | { kind: 'list' }
  /** Over a day's top row: planned for that day without a time. */
  | { kind: 'top'; day: LocalDate }

export interface GesturePreview {
  mode: GestureMode
  taskId?: number
  /** The occurrence id of an Event being moved. */
  eventId?: string
  target: GestureTarget
}

/** Where the pointer was let go, for a question asked there. */
export interface GesturePoint {
  x: number
  y: number
}

export type GestureResult =
  | { kind: 'place'; item: GestureItem; day: LocalDate; range: GestureRange; at: GesturePoint }
  | { kind: 'start' | 'end'; item: GestureItem; range: GestureRange; at: GesturePoint }
  | { kind: 'remove'; item: TaskGestureItem }
  | { kind: 'day'; item: TaskGestureItem; day: LocalDate }
  | { kind: 'draw'; day: LocalDate; range: GestureRange }

const inside = (box: DOMRect | undefined, x: number, y: number) =>
  !!box && x >= box.left && x < box.right && y >= box.top && y < box.bottom

interface GestureOptions {
  days: readonly LocalDate[]
  today: LocalDate
  scrollRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLElement | null>
  listRef?: RefObject<HTMLElement | null>
  topRowRef?: RefObject<HTMLElement | null>
  /** A point where a moved item has no target (the page-turn buttons): no preview, and a release there does nothing. */
  ignoreAt?: (x: number, y: number) => boolean
  onCommit: (result: GestureResult) => void
  onPress: (item: GestureItem, element: HTMLElement) => void
}

/**
 * Pointer gestures on the timeline: move, either edge, draw. A gesture previews locally and only the
 * release writes. The pointer is captured on the scroller, which stays when a block moves between
 * columns; Escape or losing the window cancels. The shape comes from Anton Parkhomenko's day calendar
 * (rendyhd/Vicu#58).
 */
export function useTimelineGesture(options: GestureOptions) {
  const [preview, setPreview] = useState<GesturePreview | null>(null)
  /**
   * What is being moved (past the drag threshold): a block or marker ('task') shows the drop row,
   * either turns the page.
   */
  const [moving, setMoving] = useState<GestureItem['kind'] | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const latest = useRef(options)
  latest.current = options

  useEffect(() => () => cancelRef.current?.(), [])

  const begin = (
    pointer: ReactPointerEvent<HTMLElement>,
    mode: GestureMode,
    day: LocalDate,
    item: GestureItem | null,
  ) => {
    const { scrollRef, gridRef } = latest.current
    const scroller = scrollRef.current
    const grid = gridRef.current
    if (!scroller || !grid || cancelRef.current || pointer.button !== 0 || !pointer.isPrimary) return
    pointer.preventDefault()
    pointer.stopPropagation()
    const element = pointer.currentTarget
    if (item) element.querySelector<HTMLElement>('[data-plan-focus]')?.focus({ preventScroll: true })
    const pointerId = pointer.pointerId
    scroller.setPointerCapture(pointerId)

    const startX = pointer.clientX
    const startY = pointer.clientY
    const originMinute = minuteAtY(startY, grid.getBoundingClientRect().top)
    let clientX = startX
    let clientY = startY
    let active = false
    let current: GestureTarget | null = null
    let frame = 0
    let previousTime = performance.now()

    const compute = (): GestureTarget | null => {
      const box = grid.getBoundingClientRect()
      const minute = minuteAtY(clientY, box.top)
      const { days, today, listRef, topRowRef, ignoreAt } = latest.current
      const overDay = dayAtX(days, clientX, box.left, box.width)
      if (mode === 'draw') return { kind: 'grid', day, range: drawnRange(originMinute, minute) }
      if (!item) return null
      if (mode === 'move' && ignoreAt?.(clientX, clientY)) return null
      if (mode === 'start' || mode === 'end') {
        if (!canPlaceOn(day, today)) return null
        return { kind: 'grid', day, range: mode === 'start' ? startEdgeRange(item.range, minute) : endEdgeRange(item.range, minute) }
      }
      if (item.kind === 'event') {
        // An Event stays on the timeline: over the panel or a top row it has nowhere to go.
        if (inside(listRef?.current?.getBoundingClientRect(), clientX, clientY)) return null
        if (inside(topRowRef?.current?.getBoundingClientRect(), clientX, clientY)) return null
      } else if (item.hasBlock && inside(listRef?.current?.getBoundingClientRect(), clientX, clientY)) {
        return { kind: 'list' }
      }
      if (item.kind === 'task' && inside(topRowRef?.current?.getBoundingClientRect(), clientX, clientY)) {
        // The Day view's row spans the hour gutter too: it is that one day's row all the way across.
        const rowDay = overDay ?? (days.length === 1 ? days[0] : null)
        return rowDay && canPlaceOn(rowDay, today) ? { kind: 'top', day: rowDay } : null
      }
      // Beside the columns it stays on its day, or on the day shown now when a page turned under the drag.
      const target = overDay ?? (days.includes(item.day) ? item.day : days[0])
      if (!canPlaceOn(target, today)) return null
      return { kind: 'grid', day: target, range: movedRange(item.range, minute - originMinute) }
    }

    const refresh = () => {
      if (!active && Math.hypot(clientX - startX, clientY - startY) < DRAG_THRESHOLD_PX) return
      if (!active && mode === 'move' && item) setMoving(item.kind)
      active = true
      current = compute()
      setPreview(
        current
          ? { mode, taskId: item?.kind === 'task' ? item.task.id : undefined, eventId: item?.kind === 'event' ? item.event.id : undefined, target: current }
          : null,
      )
    }

    const tick = (now: number) => {
      const elapsed = Math.min(now - previousTime, 50) / 1000
      previousTime = now
      if (active) {
        const bounds = scroller.getBoundingClientRect()
        const edge =
          clientY < bounds.top + SCROLL_EDGE_PX
            ? Math.max(-1, (clientY - bounds.top - SCROLL_EDGE_PX) / SCROLL_EDGE_PX)
            : clientY > bounds.bottom - SCROLL_EDGE_PX
              ? Math.min(1, (clientY - bounds.bottom + SCROLL_EDGE_PX) / SCROLL_EDGE_PX)
              : 0
        // Only while the pointer is over the timeline's own column: the header, the list and the row of
        // tasks without a time (a drop target of its own) do not scroll it.
        const overTopRow = inside(latest.current.topRowRef?.current?.getBoundingClientRect(), clientX, clientY)
        if (edge !== 0 && !overTopRow && clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top - SCROLL_EDGE_PX) {
          scroller.scrollTop += edge * MAX_SCROLL_PX_PER_SECOND * elapsed
          refresh()
        }
      }
      frame = requestAnimationFrame(tick)
    }

    const finish = (commit: boolean) => {
      cancelRef.current = null
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', cancel)
      scroller.removeEventListener('lostpointercapture', pointerCancel)
      if (scroller.hasPointerCapture(pointerId)) scroller.releasePointerCapture(pointerId)
      setPreview(null)
      setMoving(null)
      if (!commit) return
      if (!active) {
        if (item) latest.current.onPress(item, element)
        return
      }
      if (!current) return
      const at = { x: clientX, y: clientY }
      if (current.kind === 'list') {
        if (item?.kind === 'task') latest.current.onCommit({ kind: 'remove', item })
      } else if (current.kind === 'top') {
        if (item?.kind === 'task') latest.current.onCommit({ kind: 'day', item, day: current.day })
      } else if (mode === 'draw') {
        latest.current.onCommit({ kind: 'draw', day: current.day, range: current.range })
      } else if (item) {
        const same = current.range.startMinute === item.range.startMinute && current.range.endMinute === item.range.endMinute
        if (mode === 'move') {
          const marker = item.kind === 'task' && !item.hasBlock
          if (marker || !same || current.day !== item.day) {
            latest.current.onCommit({ kind: 'place', item, day: current.day, range: current.range, at })
          }
        } else if (!same) {
          latest.current.onCommit({ kind: mode, item, range: current.range, at })
        }
      }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      clientX = event.clientX
      clientY = event.clientY
      refresh()
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      clientX = event.clientX
      clientY = event.clientY
      refresh()
      finish(true)
    }
    const cancel = () => finish(false)
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cancel()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
    cancelRef.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', cancel)
    scroller.addEventListener('lostpointercapture', pointerCancel)
    frame = requestAnimationFrame(tick)
  }

  return { preview, moving, begin }
}
