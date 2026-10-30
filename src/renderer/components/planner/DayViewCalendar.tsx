import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check, HeartPulse, SkipForward } from 'lucide-react'
import { useDateFormat } from '@/hooks/use-date-format'
import { useCalendarEdit } from '@/hooks/use-calendar-edit'
import { useCalendarDrop } from '@/hooks/use-calendar-drop'
import { cn } from '@/lib/cn'
import {
  DAY_SLOT_HEIGHT_PX,
  DAY_SLOT_MINUTES,
  dayOpenSlotIndex,
  dayTimeSlots,
  type DayTimeSlot,
} from '@/lib/day-calendar'
import { formatDateDisplay } from '@/lib/date-display'
import { addLocalDays, startOfLocalDay, toLocalDate } from '@/lib/due-dates'
import { calDavCalendarBlocks, calendarBlockKey, layoutCalendarOverlaps, plannerCalendarEvents, type CalendarBlock, type PlannerCalendarEvents } from '@/lib/planner-calendar'
import type { CalDavEvent } from '../../../shared/caldav-types'
import type { CalendarEditMode } from '@/lib/planner-calendar-edit'

interface DayViewCalendarProps {
  /** The selected local day; today by default. */
  day: Date
  events: PlannerCalendarEvents
  isLoading: boolean
  caldavEvents?: CalDavEvent[]
  calendarErrors?: string[]
  onRefresh?: () => void
  className?: string
}

function DayHourRow({ slot, label, isLast }: { slot: DayTimeSlot; label: string; isLast: boolean }) {
  return (
    <li className="grid grid-cols-[4.5rem_1fr]">
      <div className="relative">
        <time
          dateTime={slot.isoLocal}
          className="absolute right-2 top-0 -translate-y-1/2 whitespace-nowrap text-meta text-text-secondary"
        >
          {label}
        </time>
      </div>
      <div className={cn(isLast && 'border-b border-border')}>
        <div className="border-t border-border" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
        <div className="border-t border-border/40" style={{ height: DAY_SLOT_HEIGHT_PX }} aria-hidden="true" />
      </div>
    </li>
  )
}

function CalendarEventTitle({ event }: { event: CalendarBlock }) {
  const done = event.routine ? event.routine.status === 'COMPLETED' : event.task?.done
  return (
    <span className="flex min-w-0 items-center gap-1">
      {event.routine && <HeartPulse className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {done && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {event.routine?.status === 'SKIPPED' && <SkipForward className="h-3 w-3 shrink-0" aria-hidden="true" />}
      <span className={cn('truncate', done && 'line-through')}>
        {event.caldav?.title ?? event.routine?.carrier.payload.definition.name ?? event.task?.title}
      </span>
    </span>
  )
}

/** Leave the hour label above the open line whole. */
const OPEN_CLEARANCE_PX = 10
const GRID_PADDING_PX = 12
const PIXELS_PER_MINUTE = DAY_SLOT_HEIGHT_PX / DAY_SLOT_MINUTES

const NO_CALDAV_EVENTS: CalDavEvent[] = []

/** Tasks, CalDAV events and read-only routine occurrences on the local wall-clock grid. */
export function DayViewCalendar({ day, events, isLoading, caldavEvents = NO_CALDAV_EVENTS, calendarErrors = [], onRefresh, className }: DayViewCalendarProps) {
  const dateFormat = useDateFormat()
  const titleId = useId()
  const instructionsId = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLOListElement>(null)
  const openedDay = useRef<string | null>(null)
  const [railHeight, setRailHeight] = useState<number | null>(null)
  const dayKey = toLocalDate(day)
  const dayStart = startOfLocalDay(dayKey)
  const dayEnd = startOfLocalDay(addLocalDays(dayKey, 1))
  const caldavBlocks = calDavCalendarBlocks(caldavEvents, day)
  const edit = useCalendarEdit(dayKey, { timed: [...events.timed, ...caldavBlocks] }, scrollRef, gridRef)
  const drop = useCalendarDrop(dayKey, gridRef, isLoading || edit.isPending)
  const setScrollNode = useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node
    drop.setNodeRef(node)
  }, [drop.setNodeRef])
  const dropTaskIds = new Set(drop.tasks.map((task) => task.id))
  const previewTasks = [
    ...events.timed.filter((event) => !event.routine && !dropTaskIds.has(event.task.id)).map((event) => event.task.id === edit.preview?.taskId
      ? { ...event.task, ...edit.preview.changes }
      : event.task),
    ...drop.tasks,
  ]
  const previewCalDav = edit.preview?.caldav
  const timedEvents = layoutCalendarOverlaps<CalendarBlock>([
    ...(edit.preview || drop.tasks.length > 0
      ? [...plannerCalendarEvents(previewTasks, new Set(previewTasks.map((task) => task.project_id)), day).timed,
        ...events.timed.filter((event) => event.routine)]
      : events.timed),
    ...(previewCalDav ? calDavCalendarBlocks(caldavEvents.map((event) => event.id === previewCalDav.id ? { ...event, ...previewCalDav } : event), day) : caldavBlocks),
  ])
  const hours = dayTimeSlots(dayStart).filter((slot) => slot.isHour)
  const title = formatDateDisplay('header.full', dayStart, new Date(), true, dateFormat)
  const timeLabel = (value: Date) => formatDateDisplay('logbook.time', value, dayStart, false, dateFormat)

  useLayoutEffect(() => {
    const scroller = sectionRef.current?.closest('[data-scroll-area]')
    if (!(scroller instanceof HTMLElement)) return
    const update = () => setRailHeight(scroller.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Wait until the rail actually has its measured height; before that, the full grid fits and
  // the browser clamps scrollTop to zero. Resizes and task refreshes must not reset user scrolling.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || isLoading || railHeight === null || railHeight <= 0 || openedDay.current === dayKey) return
    const now = new Date()
    const slotIndex = dayOpenSlotIndex(dayKey === toLocalDate(now), now)
    scroller.scrollTop = GRID_PADDING_PX + slotIndex * DAY_SLOT_HEIGHT_PX - OPEN_CLEARANCE_PX
    openedDay.current = dayKey
  }, [dayKey, railHeight, isLoading])

  return (
    <section
      ref={sectionRef}
      aria-labelledby={titleId}
      style={{ height: railHeight ?? undefined }}
      className={cn('sticky top-0 right-0 flex min-w-0 flex-col overflow-hidden border-l border-border bg-bg-card', className)}
    >
      <p id={instructionsId} className="sr-only">
        Drag to move. Drag the top or bottom edge to resize. Use Up and Down to adjust by 15 minutes.
        Press Escape during a drag to cancel.
      </p>
      <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-section text-text">
          <time dateTime={dayKey}>{title}</time>
        </h2>
        {onRefresh && <button type="button" onClick={onRefresh} className="ml-2 rounded-control px-2 py-1 text-caption text-text-secondary hover:bg-bg-hover">Refresh</button>}
      </header>
      {calendarErrors.length > 0 && <div role="status" className="max-h-24 shrink-0 overflow-y-auto border-b border-border px-4 py-2 text-caption text-danger">{calendarErrors.map((error) => <p key={error}>{error}</p>)}</div>}
      {caldavEvents.some((event) => event.allDay) && (
        <ul aria-label="All-day calendar events" className="max-h-32 shrink-0 space-y-1 overflow-y-auto border-b border-border px-4 py-2">
          {caldavEvents.filter((event) => event.allDay).map((event) => (
            <li key={event.id} title={`${event.calendarName}: ${event.title}, all day`} className="truncate rounded-control border-l-4 bg-bg-hover px-2 py-1 text-meta text-text" style={{ borderColor: event.color }}>
              {event.title} <span className="text-caption text-text-secondary">· {event.calendarName} · All day</span>
            </li>
          ))}
        </ul>
      )}
      <div
        ref={setScrollNode}
        onScroll={drop.onScroll}
        role="region"
        aria-label="Day schedule"
        tabIndex={0}
        onKeyDown={(event) => {
          // Let this scroll region's arrows scroll it, rather than moving focus to a Planner row.
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation()
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
        style={{ paddingBlock: GRID_PADDING_PX }}
      >
        <div className="relative">
          <ol aria-label="Hours">
            {hours.map((slot, index) => (
              <DayHourRow key={slot.minutesFromMidnight} slot={slot} label={timeLabel(slot.labelTime)} isLast={index === hours.length - 1} />
            ))}
          </ol>
          <ol ref={gridRef} aria-label="Scheduled tasks" className="absolute inset-y-0 left-[4.5rem] right-0">
            {timedEvents.map((event) => {
              const isDropPreview = !event.routine && !event.caldav && dropTaskIds.has(event.task.id)
              const editable = !event.routine && !event.caldav?.readOnly
              const range = `${timeLabel(event.start)} – ${timeLabel(event.end)}`
              const name = event.caldav?.title ?? event.routine?.carrier.payload.definition.name ?? event.task?.title
              const done = event.routine ? event.routine.status === 'COMPLETED' : event.task?.done
              const label = `${name}, ${range}${event.caldav ? `, ${event.caldav.calendarName}${event.caldav.readOnly ? ', read-only' : ''}` : ''}${event.routine ? ', routine' : ''}${done ? ', completed' : ''}${event.routine?.status === 'SKIPPED' ? ', skipped' : ''}`
              const height = (event.endMinute - event.startMinute) * PIXELS_PER_MINUTE
              return (
                <li
                  key={calendarBlockKey(event)}
                  data-calendar-caldav={event.caldav?.id}
                  data-calendar-routine={event.routine?.key}
                  data-calendar-task={isDropPreview || event.routine || event.caldav ? undefined : event.task.id}
                  data-calendar-drop-preview={isDropPreview ? event.task?.id : undefined}
                  aria-label={isDropPreview ? `Schedule preview: ${label}` : label}
                  title={label}
                  onPointerDown={(pointer) => {
                    if (isDropPreview || !editable) return
                    const bounds = pointer.currentTarget.getBoundingClientRect()
                    const mode = pointer.clientY - bounds.top < 8 && event.start >= dayStart ? 'start'
                      : bounds.bottom - pointer.clientY < 8 && event.end <= dayEnd ? 'end'
                        : 'move'
                    edit.onPointerDown(pointer, event, mode)
                  }}
                  style={{
                    borderColor: event.caldav?.color,
                    borderLeftWidth: event.caldav ? 4 : undefined,
                    backgroundColor: event.caldav ? `${event.caldav.color}18` : undefined,
                    top: event.startMinute * PIXELS_PER_MINUTE,
                    height,
                    left: `${event.column / event.columnCount * 100}%`,
                    width: `${100 / event.columnCount}%`,
                  }}
                  className={cn(
                    'group absolute touch-none select-none overflow-hidden rounded-control border border-accent-blue bg-bg-selected px-1.5 pt-2 text-meta text-text',
                    editable && 'cursor-ns-resize',
                    (event.caldav ? edit.preview?.caldav?.id === event.caldav.id : !event.routine && edit.preview?.taskId === event.task.id) && 'z-10 shadow-lg',
                    isDropPreview && 'pointer-events-none z-20 border-dashed ring-2 ring-accent-blue shadow-lg',
                  )}
                >
                  {!isDropPreview && editable && (['move', 'start', 'end'] as const).map((mode: CalendarEditMode) => {
                    // A clipped border is not the task's real edge. Don't resize a hidden endpoint.
                    if (mode === 'start' && event.start < dayStart) return null
                    if (mode === 'end' && event.end > dayEnd) return null
                    const action = mode === 'move' ? 'Move' : mode === 'start' ? 'Resize start of' : 'Resize end of'
                    return (
                      <button
                        key={mode}
                        type="button"
                        aria-label={`${action} ${label}`}
                        aria-describedby={instructionsId}
                        aria-disabled={edit.isPending}
                        data-calendar-edit={mode}
                        onKeyDown={(key) => edit.onKeyDown(key, event, mode)}
                        className={cn(
                          'absolute left-0 right-0 touch-none rounded-control focus-visible:-outline-offset-2 aria-disabled:cursor-wait',
                          mode === 'move' ? 'inset-y-0 cursor-grab active:cursor-grabbing' : 'z-10 flex h-2 cursor-ns-resize items-center justify-center',
                          mode === 'start' && 'top-0',
                          mode === 'end' && 'bottom-0',
                        )}
                      >
                        {mode !== 'move' && (
                          <span aria-hidden="true" style={{ backgroundColor: event.caldav?.color }} className="h-0.5 w-5 rounded-full bg-accent-blue opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                        )}
                      </button>
                    )
                  })}
                  <div className="pointer-events-none relative">
                    <CalendarEventTitle event={event} />
                    {height >= 44 && <span className="block truncate text-caption text-text-secondary">{range}{event.caldav ? ` · ${event.caldav.calendarName}` : ''}</span>}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
