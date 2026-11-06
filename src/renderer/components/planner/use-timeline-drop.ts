import { useEffect, useRef, useState, type RefObject } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { canPlaceOn, dayAtX, minuteAtY, snapMinutes } from '@/lib/planner-timeline'
import type { Task } from '@/lib/vikunja-types'
import type { LocalDate } from '../../../shared/due-dates'
import { BLOCK_STEP_MINUTES, blockOf } from '../../../shared/time-blocks'

/** Read by AppShell: a task dragged from a list lands here, and the page decides what it means. */
export interface PlanDropData {
  type: 'plan-drop'
  drop: (tasks: Task[]) => void
}

export const PLAN_DROP = 'plan-drop'

export interface DropHover {
  day: LocalDate
  minute: number
  tasks: Task[]
}

interface DropOptions {
  days: readonly LocalDate[]
  today: LocalDate
  gridRef: RefObject<HTMLElement | null>
  scrollRef: RefObject<HTMLElement | null>
  lengthOf: (task: Task) => number
  /** Several tasks go one after the other from the time they were dropped on. */
  onPlace: (task: Task, day: LocalDate, startMinute: number, minutes: number) => void
}

/**
 * A task dragged out of a list onto a time. The hover is read from the live pointer, not from
 * dnd-kit's scroll-adjusted delta, so it stays right while the timeline scrolls under the drag.
 * From Anton Parkhomenko's calendar drop (rendyhd/Vicu#58).
 */
export function useTimelineDrop({ days, today, gridRef, scrollRef, lengthOf, onPlace }: DropOptions) {
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef<Task[] | null>(null)
  const [hover, setHover] = useState<DropHover | null>(null)
  const latest = useRef({ days, today, lengthOf, onPlace })
  latest.current = { days, today, lengthOf, onPlace }

  const targetAt = (): { day: LocalDate; minute: number } | null => {
    const grid = gridRef.current
    const scroller = scrollRef.current
    if (!grid || !scroller || !pointer.current) return null
    const bounds = scroller.getBoundingClientRect()
    const { x, y } = pointer.current
    if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null
    const box = grid.getBoundingClientRect()
    const day = dayAtX(latest.current.days, x, box.left, box.width)
    if (!day || !canPlaceOn(day, latest.current.today)) return null
    return { day, minute: Math.min(snapMinutes(minuteAtY(y, box.top)), 24 * 60 - BLOCK_STEP_MINUTES) }
  }

  const data: PlanDropData = {
    type: PLAN_DROP,
    drop: (tasks) => {
      const target = targetAt()
      if (!target) return
      let start = target.minute
      for (const task of tasks) {
        const minutes = latest.current.lengthOf(task)
        latest.current.onPlace(task, target.day, start, minutes)
        start = Math.min(start + minutes, 24 * 60 - BLOCK_STEP_MINUTES)
      }
    },
  }
  const { setNodeRef } = useDroppable({ id: 'plan-timeline', data })

  const refresh = () => {
    const tasks = dragging.current
    const target = tasks ? targetAt() : null
    setHover(tasks && target ? { ...target, tasks } : null)
  }
  const clear = () => {
    dragging.current = null
    setHover(null)
  }

  useDndMonitor({
    onDragStart: ({ active }) => {
      const current = active.data.current as { type?: string; task?: Task } | undefined
      if (current?.type !== 'task' || !current.task) return
      dragging.current = [current.task]
      refresh()
    },
    onDragEnd: clear,
    onDragCancel: clear,
  })

  useEffect(() => {
    // Tracked before the sensor starts a drag, so the first move has the live position.
    const move = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY }
      if (dragging.current) refresh()
    }
    window.addEventListener('pointermove', move, true)
    return () => window.removeEventListener('pointermove', move, true)
  }, [])

  return { setNodeRef, hover, refresh }
}

/** The length a task takes when dropped: its block's own, else the default (contract 16.2). */
export function lengthWhenPlaced(task: Task, defaultLength: number): number {
  return blockOf(task)?.minutes ?? defaultLength
}
