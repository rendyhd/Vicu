import { useEffect, useRef, useState, type RefObject } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { useQueryClient } from '@tanstack/react-query'
import { plannerCalendarDropStart, type PlannerCalendarDropData } from '@/lib/planner-calendar-drop'
import { resolveDraggedTasks } from '@/lib/task-selection'
import type { Task } from '@/lib/vikunja-types'
import { useSelectionStore } from '@/stores/selection-store'

/** Bridge Planner's row DnD into the calendar, without persisting hover previews. */
export function useCalendarDrop(
  dayKey: string,
  gridRef: RefObject<HTMLOListElement | null>,
  disabled: boolean,
) {
  const queryClient = useQueryClient()
  const [tasks, setTasks] = useState<Task[]>([])
  const [startDate, setStartDate] = useState<string | null>(null)
  const pointerY = useRef<number | null>(null)
  const dragDay = useRef<string | null>(null)
  const getStartDate = () => {
    const grid = gridRef.current
    if (!grid || pointerY.current === null || dragDay.current !== dayKey) return null
    return plannerCalendarDropStart(dayKey, pointerY.current, grid.getBoundingClientRect().top)
  }
  const data: PlannerCalendarDropData = { type: 'planner-calendar', getStartDate }
  const { setNodeRef, isOver } = useDroppable({ id: 'planner-calendar', data, disabled })
  const refresh = () => setStartDate(getStartDate())
  const clear = () => {
    pointerY.current = null
    dragDay.current = null
    setTasks([])
    setStartDate(null)
  }

  useDndMonitor({
    onDragStart: ({ active, activatorEvent }) => {
      if (active.data.current?.type !== 'task') return
      dragDay.current = dayKey
      pointerY.current ??= (activatorEvent as PointerEvent).clientY
      setTasks(resolveDraggedTasks(queryClient, active.data.current.task as Task, useSelectionStore.getState().selectedTaskIds))
      refresh()
    },
    onDragMove: refresh,
    onDragOver: refresh,
    onDragEnd: clear,
    onDragCancel: clear,
  })

  useEffect(() => {
    const move = (event: PointerEvent) => {
      // Track before the sensor activates, so even the first move straight into the calendar
      // has the live pointer position, without dnd-kit's scroll-adjusted drag delta.
      pointerY.current = event.clientY
      if (dragDay.current === dayKey) setStartDate(getStartDate())
    }
    window.addEventListener('pointermove', move, true)
    return () => window.removeEventListener('pointermove', move, true)
  }, [dayKey])

  return {
    setNodeRef,
    onScroll: refresh,
    tasks: isOver && startDate && dragDay.current === dayKey
      ? tasks.map((task) => ({ ...task, start_date: startDate }))
      : [],
  }
}
