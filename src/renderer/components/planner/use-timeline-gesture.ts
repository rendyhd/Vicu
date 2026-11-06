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

const SCROLL_EDGE_PX = 32
const MAX_SCROLL_PX_PER_SECOND = 600

/** What a press grabbed: a block or a marker with its real times; nothing when drawing. */
export interface GestureItem {
  task: Task
  day: LocalDate
  range: GestureRange
  hasBlock: boolean
}

export type GestureTarget =
  | { kind: 'grid'; day: LocalDate; range: GestureRange }
  /** Over the left panel: the block goes back to the list. */
  | { kind: 'list' }
  /** Over a day's top row: planned for that day without a time. */
  | { kind: 'top'; day: LocalDate }

export interface GesturePreview {
  mode: GestureMode
  taskId?: number
  target: GestureTarget
}

export type GestureResult =
  | { kind: 'place'; item: GestureItem; day: LocalDate; range: GestureRange }
  | { kind: 'start' | 'end'; item: GestureItem; range: GestureRange }
  | { kind: 'remove'; item: GestureItem }
  | { kind: 'day'; item: GestureItem; day: LocalDate }
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
      const { days, today, listRef, topRowRef } = latest.current
      const overDay = dayAtX(days, clientX, box.left, box.width)
      if (mode === 'draw') return { kind: 'grid', day, range: drawnRange(originMinute, minute) }
      if (!item) return null
      if (mode === 'start' || mode === 'end') {
        if (!canPlaceOn(day, today)) return null
        return { kind: 'grid', day, range: mode === 'start' ? startEdgeRange(item.range, minute) : endEdgeRange(item.range, minute) }
      }
      if (item.hasBlock && inside(listRef?.current?.getBoundingClientRect(), clientX, clientY)) return { kind: 'list' }
      if (inside(topRowRef?.current?.getBoundingClientRect(), clientX, clientY)) {
        return overDay && canPlaceOn(overDay, today) ? { kind: 'top', day: overDay } : null
      }
      const target = overDay ?? item.day
      if (!canPlaceOn(target, today)) return null
      return { kind: 'grid', day: target, range: movedRange(item.range, minute - originMinute) }
    }

    const refresh = () => {
      if (!active && Math.hypot(clientX - startX, clientY - startY) < DRAG_THRESHOLD_PX) return
      active = true
      current = compute()
      setPreview(current ? { mode, taskId: item?.task.id, target: current } : null)
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
        // Only while the pointer is over the timeline's own column: the header and the list do not scroll it.
        if (edge !== 0 && clientX >= bounds.left && clientX < bounds.right && clientY >= bounds.top - SCROLL_EDGE_PX) {
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
      if (!commit) return
      if (!active) {
        if (item) latest.current.onPress(item, element)
        return
      }
      if (!current) return
      if (current.kind === 'list') {
        if (item) latest.current.onCommit({ kind: 'remove', item })
      } else if (current.kind === 'top') {
        if (item) latest.current.onCommit({ kind: 'day', item, day: current.day })
      } else if (mode === 'draw') {
        latest.current.onCommit({ kind: 'draw', day: current.day, range: current.range })
      } else if (item) {
        const same = current.range.startMinute === item.range.startMinute && current.range.endMinute === item.range.endMinute
        if (mode === 'move') {
          if (!item.hasBlock || !same || current.day !== item.day) {
            latest.current.onCommit({ kind: 'place', item, day: current.day, range: current.range })
          }
        } else if (!same) {
          latest.current.onCommit({ kind: mode, item, range: current.range })
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

  return { preview, begin }
}
