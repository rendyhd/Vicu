import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { useUpdateTask } from '@/hooks/use-task-mutations'
import { useUpdateCalDavEvent } from '@/hooks/use-caldav'
import type { CalDavEventUpdate } from '../../shared/caldav-types'
import { DAY_SLOT_COUNT, DAY_SLOT_HEIGHT_PX, DAY_SLOT_MINUTES } from '@/lib/day-calendar'
import { calendarEditRange, calendarEditChanges, CALENDAR_SNAP_MINUTES, snapCalendarMinutes, type CalendarEditMode } from '@/lib/planner-calendar-edit'
import { calendarBlockKey, type CalendarBlock } from '@/lib/planner-calendar'
import type { Task } from '@/lib/vikunja-types'
import { announce } from '@/stores/announcer-store'

const PIXELS_PER_MINUTE = DAY_SLOT_HEIGHT_PX / DAY_SLOT_MINUTES
const DRAG_THRESHOLD_PX = 4
const SCROLL_EDGE_PX = 32
const MAX_SCROLL_PX_PER_SECOND = 600

interface CalendarPreview {
  taskId?: number
  changes: Partial<Task>
  caldav?: CalDavEventUpdate
}

/** A gesture previews locally; only release writes through the normal optimistic/offline path. */
export function useCalendarEdit(
  dayKey: string,
  events: { timed: CalendarBlock[] },
  scrollRef: RefObject<HTMLDivElement | null>,
  gridRef: RefObject<HTMLOListElement | null>,
) {
  const updateTask = useUpdateTask()
  const updateCalDav = useUpdateCalDavEvent()
  const isPending = updateTask.isPending || updateCalDav.isPending
  const [preview, setPreview] = useState<CalendarPreview | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const eventsRef = useRef(events)
  eventsRef.current = events

  useEffect(() => () => cancelRef.current?.(), [dayKey])

  const previewFor = (event: CalendarBlock, mode: CalendarEditMode, delta: number): CalendarPreview => {
    if (event.caldav) return { changes: {}, caldav: { id: event.caldav.id, ...calendarEditRange(event, mode, delta) } }
    // A background refresh or another property edit may have updated notes during the gesture.
    const latest = eventsRef.current.timed.find((item) => calendarBlockKey(item) === calendarBlockKey(event))
    return { taskId: event.task.id, changes: calendarEditChanges({ ...event, task: latest?.task ?? event.task }, mode, delta) }
  }
  const save = (event: CalendarBlock, preview: CalendarPreview) => {
    if (event.routine) return
    if (event.caldav) {
      if (!preview.caldav || (preview.caldav.start === event.caldav.start && preview.caldav.end === event.caldav.end)) return
      updateCalDav.mutate(preview.caldav, { onSuccess: () => announce(`Schedule updated for ${event.caldav.title}.`) })
      return
    }
    if (Object.keys(preview.changes).length === 0) return
    const latest = eventsRef.current.timed.find((item) => calendarBlockKey(item) === calendarBlockKey(event))
    updateTask.mutate({ id: event.task.id, original: latest?.task ?? event.task, changes: preview.changes }, {
      onSuccess: () => announce(`Schedule updated for ${event.task.title}.`),
    })
  }

  const onPointerDown = (pointer: PointerEvent<HTMLElement>, event: CalendarBlock, mode: CalendarEditMode) => {
    if (event.routine || event.caldav?.readOnly || pointer.button !== 0 || !pointer.isPrimary || isPending || cancelRef.current) return
    const scroller = scrollRef.current
    const grid = gridRef.current
    if (!scroller || !grid) return
    pointer.preventDefault()
    pointer.stopPropagation()
    pointer.currentTarget.querySelector<HTMLElement>(`[data-calendar-edit="${mode}"]`)?.focus({ preventScroll: true })
    // Capture on the stable scroll region, not a block which can leave the day during preview.
    scroller.setPointerCapture(pointer.pointerId)
    const pointerId = pointer.pointerId
    const startY = pointer.clientY
    const origin = startY - grid.getBoundingClientRect().top
    let clientY = startY
    let active = false
    let delta = 0
    let lastDelta: number | null = null
    let frame = 0
    let previousTime = performance.now()

    const refresh = () => {
      if (!active && Math.abs(clientY - startY) < DRAG_THRESHOLD_PX) return
      active = true
      const minute = Math.max(0, Math.min(DAY_SLOT_COUNT * DAY_SLOT_MINUTES, (clientY - grid.getBoundingClientRect().top) / PIXELS_PER_MINUTE))
      delta = snapCalendarMinutes(minute - origin / PIXELS_PER_MINUTE)
      if (delta === lastDelta) return
      lastDelta = delta
      setPreview(previewFor(event, mode, delta))
    }
    const tick = (now: number) => {
      const elapsed = Math.min(now - previousTime, 50) / 1000
      previousTime = now
      if (active) {
        const bounds = scroller.getBoundingClientRect()
        const edge = clientY < bounds.top + SCROLL_EDGE_PX
          ? Math.max(-1, (clientY - bounds.top - SCROLL_EDGE_PX) / SCROLL_EDGE_PX)
          : clientY > bounds.bottom - SCROLL_EDGE_PX
            ? Math.min(1, (clientY - bounds.bottom + SCROLL_EDGE_PX) / SCROLL_EDGE_PX)
            : 0
        if (edge !== 0) {
          scroller.scrollTop += edge * MAX_SCROLL_PX_PER_SECOND * elapsed
          refresh()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    const move = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return
      clientY = e.clientY
      refresh()
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
      if (commit && active) save(event, previewFor(event, mode, delta))
    }
    const up = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId) return
      clientY = e.clientY
      refresh()
      finish(true)
    }
    const cancel = () => finish(false)
    const pointerCancel = (e: globalThis.PointerEvent) => {
      if (e.pointerId === pointerId) cancel()
    }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
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

  const onKeyDown = (key: KeyboardEvent<HTMLButtonElement>, event: CalendarBlock, mode: CalendarEditMode) => {
    if (key.key !== 'ArrowUp' && key.key !== 'ArrowDown') return
    key.preventDefault()
    key.stopPropagation()
    if (event.routine || event.caldav?.readOnly || isPending || cancelRef.current || key.repeat) return
    save(event, previewFor(event, mode, key.key === 'ArrowUp' ? -CALENDAR_SNAP_MINUTES : CALENDAR_SNAP_MINUTES))
  }

  return { preview, onPointerDown, onKeyDown, isPending }
}
