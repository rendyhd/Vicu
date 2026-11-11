import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CalendarDays, HeartPulse } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDateFormat } from '@/hooks/use-date-format'
import { useProjects } from '@/hooks/use-projects'
import { useProjectAccessMap } from '@/hooks/use-project-access'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { formatDateDisplay } from '@/lib/date-display'
import {
  DAY_MINUTES,
  HOUR_HEIGHT_PX,
  PX_PER_MINUTE,
  dayBlocks,
  dayMarkers,
  layoutWithEvents,
  markerOverBlock,
  dayTopRow,
  grabMode,
  openingMinute,
  canPlaceOn,
  type GestureRange,
} from '@/lib/planner-timeline'
import { formatBlockRange } from '../../../shared/date-display'
import { normalizeHex } from '@/lib/constants'
import type { Task } from '@/lib/vikunja-types'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '../../../shared/due-dates'
import {
  atClock,
  blockOf,
  clockMinutes,
  minutesOfDay,
  placeBlock,
  planForDay,
  removeTime,
  resizeBlockEnd,
  resizeBlockStart,
  type BlockChanges,
  type PlannerHours,
} from '../../../shared/time-blocks'
import type { PlanRoutine } from '@/hooks/use-planner'
import { CALENDAR_COLORS, allDayEventsOn, timedEventsOn, type CalendarEvent } from '../../../shared/calendar-events'
import { useTimelineGesture, type EventGestureItem, type GestureItem, type GesturePoint, type GestureResult } from './use-timeline-gesture'
import { PLAN_DROP, lengthWhenPlaced, useTimelineDrop, type PlanDropData } from './use-timeline-drop'
import { turnAt, usePageTurnWhileDragging, type PageTurn } from './use-page-turn'

export type TimelineRoutine = PlanRoutine

interface TimelineProps {
  days: readonly LocalDate[]
  selectedDay: LocalDate
  onSelectDay: (day: LocalDate) => void
  tasks: readonly Task[]
  routines: readonly TimelineRoutine[]
  defaultLength: number
  hours: PlannerHours
  isLoading: boolean
  /** The left panel: a block dragged onto it loses its time. */
  listRef: RefObject<HTMLElement | null>
  /** Every change of a block or a day goes here: the page writes it, or keeps it in a draft. */
  onChange: (task: Task, changes: BlockChanges) => void
  /** A press without a drag. */
  onPressBlock?: (task: Task, element: HTMLElement) => void
  /** A stretch was drawn on an empty time. */
  onDraw?: (day: LocalDate, range: GestureRange) => void
  /** The stretch waiting for a title. */
  drawn?: { day: LocalDate; range: GestureRange } | null
  drawnRef?: RefObject<HTMLDivElement | null>
  /** Dashed: suggested or draft blocks, not saved yet. */
  dashedIds?: ReadonlySet<number>
  /** While Plan my day arranges a draft: no drawing and no ticking. */
  draft?: boolean
  /** Why each dashed block sits there (the assistant's reason). */
  reasonOf?: (task: Task) => string | undefined
  /** In place of the hint under the day's name. */
  note?: string
  /** Day view: resting a drag on Back or Forward turns the page. */
  pageTurn?: PageTurn
  /** Calendar events (proof of concept): read-only, drawn beside the blocks. */
  events?: readonly CalendarEvent[]
  eventColor?: (calendarId: string) => string | undefined
  /** A press on an event (or Enter on it). */
  onPressEvent?: (event: CalendarEvent, element: HTMLElement) => void
  /** Whether an event can be moved and its edges dragged: one of your own Events (20.7). */
  canChangeEvent?: (event: CalendarEvent) => boolean
  /**
   * An Event moved or resized: by the pointer (`point`, where it was let go) or the keyboard
   * (`element`, the event). The page asks which times when it repeats, then writes.
   */
  onChangeEvent?: (event: CalendarEvent, to: EventMove, anchor: { element?: HTMLElement; point?: GesturePoint }) => void
  /** A change waiting for its answer: drawn where it goes, the event itself faded. */
  pendingEvent?: ({ id: string } & EventMove) | null
}

/** Where an Event's occurrence goes: its day and wall-clock minutes. */
export interface EventMove {
  day: LocalDate
  startMinute: number
  endMinute: number
}

const NO_EVENTS: readonly CalendarEvent[] = []

const GUTTER_CLASS = 'w-14 shrink-0'
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/** The hour labels are a fixed reference day, so a clock-change day still labels every line. */
function hourLabel(hour: number, fmt: ReturnType<typeof useDateFormat>): string {
  return formatDateDisplay('logbook.time', new Date(2000, 0, 15, hour), new Date(2000, 0, 15), false, fmt)
}

function TopRowChip({ task, draggable, wide = false }: { task: Task; draggable: boolean; wide?: boolean }) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `plan-chip-${task.id}`,
    data: { type: 'task', task },
    disabled: !draggable,
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-plan-chip={task.id}
      title={task.title}
      className={cn(
        'truncate rounded-chip border border-border bg-bg-card px-1.5 py-0.5 text-caption text-text',
        wide && 'max-w-[16rem]',
        draggable && 'cursor-grab',
        isDragging && 'opacity-50',
      )}
    >
      {task.title}
    </div>
  )
}

function DayTopRow({
  day,
  tasks,
  canDrop,
  canChange,
  onDropTasks,
  highlighted = false,
  wide = false,
  emptyText,
  allDay = NO_EVENTS,
  eventColor,
  onPressEvent,
}: {
  day: LocalDate
  tasks: readonly Task[]
  /** All-day calendar events, before the tasks; never dragged. */
  allDay?: readonly CalendarEvent[]
  eventColor?: (calendarId: string) => string | undefined
  onPressEvent?: (event: CalendarEvent, element: HTMLElement) => void
  canDrop: boolean
  canChange: (task: Task) => boolean
  onDropTasks: (tasks: Task[]) => void
  /** A block moved by the timeline's own gesture is over it. */
  highlighted?: boolean
  /** The Day view's one column: chips side by side, wrapping. */
  wide?: boolean
  /** Shown while it has no tasks (the Day view's drop target during a drag). */
  emptyText?: string
}) {
  const data: PlanDropData = { type: PLAN_DROP, drop: onDropTasks }
  const { setNodeRef, isOver } = useDroppable({ id: `plan-day-${day}`, data, disabled: !canDrop })
  return (
    <div
      ref={setNodeRef}
      data-plan-top={day}
      className={cn(
        'flex max-h-24 min-h-[30px] min-w-0 flex-1 overflow-y-auto border-l border-border p-1',
        wide ? 'flex-row flex-wrap content-start items-center gap-1' : 'flex-col gap-0.5',
        (isOver || highlighted) && 'bg-bg-selected',
      )}
    >
      {allDay.map((event) => (
        <AllDayChip key={event.id} event={event} color={eventColor?.(event.calendarId)} wide={wide} onPress={onPressEvent} />
      ))}
      {tasks.length === 0 && allDay.length === 0 && emptyText && (
        <span className="flex min-w-0 flex-1 items-center justify-center truncate text-caption text-text-secondary">{emptyText}</span>
      )}
      {tasks.map((task) => (
        <TopRowChip key={task.id} task={task} draggable={canChange(task)} wide={wide} />
      ))}
    </div>
  )
}

function AllDayChip({ event, color, wide, onPress }: { event: CalendarEvent; color?: string; wide: boolean; onPress?: (event: CalendarEvent, element: HTMLElement) => void }) {
  return (
    <button
      type="button"
      data-plan-allday-event={event.id}
      onPointerDown={(pointer) => pointer.stopPropagation()}
      onClick={(click) => onPress?.(event, click.currentTarget)}
      title={`${event.title} (all day)`}
      className={cn('flex min-w-0 items-center gap-1 truncate rounded-chip border border-border px-1.5 py-0.5 text-left text-caption text-text', wide && 'max-w-[16rem]')}
      style={{ backgroundColor: color ? `${color}24` : undefined, borderColor: color ?? undefined }}
    >
      <CalendarDays className="h-3 w-3 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="truncate">{event.title}</span>
    </button>
  )
}

/**
 * An event on the grid, striped so it never reads as a task. A calendar's is read-only; one of your
 * own Events can be moved and its edges dragged like a block (`editable`).
 */
const EventView = memo(function EventView({
  event,
  top,
  height,
  left,
  width,
  range,
  color,
  onPress,
  editable = false,
  hidden = false,
  instructionsId,
  onGrab,
  onKey,
}: {
  event: CalendarEvent
  top: number
  height: number
  left: string
  width: string
  range: string
  color: string
  onPress?: (event: CalendarEvent, element: HTMLElement) => void
  editable?: boolean
  /** Faded while it is moved, or while its move waits for an answer. */
  hidden?: boolean
  instructionsId?: string
  onGrab?: (pointer: React.PointerEvent<HTMLElement>) => void
  onKey?: (key: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const compact = height < 40
  // A free event is fainter, but only its tint and edge: the words keep their contrast.
  const tint = event.busy ? `${color}29` : `${color}14`
  const stripe = event.busy ? `${color}14` : `${color}0a`
  return (
    <li
      data-plan-event={event.id}
      title={[event.title, range, event.location, event.tentative ? 'Tentative' : null, event.busy ? null : 'Free'].filter(Boolean).join(' · ')}
      // Never starts a drawing; a calendar's never moves, and a press opens it.
      onPointerDown={(pointer) => {
        if (editable && onGrab) {
          onGrab(pointer)
          return
        }
        pointer.stopPropagation()
        if (pointer.button === 0) onPress?.(event, pointer.currentTarget)
      }}
      style={{
        top,
        height,
        left,
        width,
        borderLeftColor: event.busy ? color : `${color}99`,
        backgroundImage: `repeating-linear-gradient(135deg, ${tint} 0 6px, ${stripe} 6px 12px)`,
      }}
      data-plan-event-editable={editable || undefined}
      className={cn(
        'pointer-events-auto absolute overflow-hidden rounded-control border border-l-[3px] border-border bg-bg-page pl-1.5 pr-1 select-none',
        editable ? 'touch-none cursor-grab active:cursor-grabbing' : 'cursor-default',
        event.tentative && 'border-dashed',
        hidden && 'opacity-30',
      )}
    >
      <button
        type="button"
        data-plan-focus
        aria-describedby={editable ? instructionsId : undefined}
        onKeyDown={editable ? onKey : undefined}
        onClick={(click) => {
          // By keyboard; a press goes through the pointer handler above.
          if (click.detail === 0) onPress?.(event, click.currentTarget.closest('li') as HTMLElement)
        }}
        className={cn(
          'flex h-full w-full min-w-0 flex-col rounded-control text-left focus-visible:-outline-offset-2',
          editable ? 'cursor-[inherit]' : 'cursor-default',
          compact ? 'justify-center' : 'justify-start pt-1',
        )}
      >
        <span className="flex min-w-0 items-center gap-1">
          <CalendarDays className="h-3 w-3 shrink-0" style={{ color }} aria-hidden="true" />
          <span className="truncate text-meta font-medium text-text">{event.title}</span>
        </span>
        <span className={compact ? 'sr-only' : 'block truncate text-caption text-text-secondary'}>
          {range}
          {event.location ? ` · ${event.location}` : ''}
          {event.tentative ? ' · Tentative' : ''}
          {event.busy ? '' : ' · Free'}
        </span>
      </button>
      {editable && (
        <>
          <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 z-[1] cursor-ns-resize', compact ? 'h-1' : 'h-1.5')} />
          <span aria-hidden="true" className={cn('absolute inset-x-0 bottom-0 z-[1] cursor-ns-resize', compact ? 'h-1' : 'h-1.5')} />
        </>
      )}
    </li>
  )
})

interface BlockViewProps {
  task: Task
  top: number
  height: number
  left: string
  width: string
  range: string
  color: string | null
  editable: boolean
  dashed: boolean
  draft: boolean
  reason?: string
  hidden: boolean
  instructionsId: string
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onKey: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}

/** Below this height a block has only its title. */
const TINY_BLOCK_PX = 20
/** Room above the hour the grid opens on, so its label and first block are not cut off. */
const OPENING_MARGIN_PX = 20

const BlockView = memo(function BlockView(props: BlockViewProps) {
  const { task, top, height, left, width, range, color, editable, dashed, draft, reason, hidden, instructionsId } = props
  const compact = height < 40
  // Too short for a checkbox: the block's popover has one.
  const tiny = height < TINY_BLOCK_PX
  // The tint lies on the page colour, so the grid's lines do not run through the text.
  const tint = color ? `${color}1f` : 'rgb(var(--accent-blue-rgb) / 0.12)'
  return (
    <li
      data-plan-block={task.id}
      onPointerDown={props.onPointerDown}
      style={{
        top,
        height,
        left,
        width,
        borderLeftColor: color ?? undefined,
        backgroundImage: `linear-gradient(${tint}, ${tint})`,
      }}
      className={cn(
        'group pointer-events-auto absolute overflow-hidden rounded-control border border-l-[3px] border-border bg-bg-page pl-1.5 pr-1 touch-none select-none',
        editable && 'cursor-grab active:cursor-grabbing',
        dashed && 'border-dashed border-accent-blue',
        task.done && 'opacity-70',
        hidden && 'opacity-30',
      )}
    >
      <div className={cn('flex h-full min-w-0 gap-1.5', compact ? 'items-center' : 'items-start pt-1')}>
        {!draft && editable && !tiny && (
          <span className="shrink-0" onPointerDown={(event) => event.stopPropagation()}>
            <TaskCheckbox task={task} />
          </span>
        )}
        <button
          type="button"
          data-plan-focus
          aria-describedby={instructionsId}
          onKeyDown={props.onKey}
          className={cn('flex h-full min-w-0 flex-1 flex-col rounded-control text-left focus-visible:-outline-offset-2', compact ? 'justify-center' : 'justify-start', editable ? 'cursor-[inherit]' : 'cursor-default')}
        >
          <span className={cn('block truncate font-medium text-text', tiny ? 'text-caption leading-none' : 'text-meta', task.done && 'line-through')}>{task.title}</span>
          <span className={compact ? 'sr-only' : 'block truncate text-caption text-text-secondary'}>{range}</span>
          {task.done && <span className="sr-only">, done</span>}
          {!compact && reason && height >= 58 && <span className="block truncate text-caption text-text-secondary">{reason}</span>}
        </button>
      </div>
      {editable && (
        <>
          <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 z-[1] cursor-ns-resize', compact ? 'h-1' : 'h-1.5')} />
          <span aria-hidden="true" className={cn('absolute inset-x-0 bottom-0 z-[1] cursor-ns-resize', compact ? 'h-1' : 'h-1.5')} />
        </>
      )}
    </li>
  )
})

/** Tasks, due-time markers and routines on the wall-clock grid, for one day or several side by side. */
export function Timeline({
  days,
  selectedDay,
  onSelectDay,
  tasks,
  routines,
  defaultLength,
  hours,
  isLoading,
  listRef,
  onChange,
  onPressBlock,
  onDraw,
  drawn,
  drawnRef,
  dashedIds,
  draft = false,
  reasonOf,
  note,
  pageTurn,
  events = NO_EVENTS,
  eventColor,
  onPressEvent,
  canChangeEvent,
  onChangeEvent,
  pendingEvent,
}: TimelineProps) {
  const fmt = useDateFormat()
  const now = useMinuteClock()
  const today = toLocalDate(now)
  const instructionsId = useId()
  const eventInstructionsId = useId()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const topRowRef = useRef<HTMLDivElement | null>(null)
  const { data: projects } = useProjects()
  const access = useProjectAccessMap()
  const multiDay = days.length > 1

  const projectColor = useMemo(() => {
    const colors = new Map<number, string | null>()
    for (const project of projects?.flat ?? []) colors.set(project.id, normalizeHex(project.hex_color) ?? null)
    return colors
  }, [projects])

  const canChange = useCallback(
    (task: Task) => (access.get(task.project_id)?.permission ?? 1) > 0,
    [access],
  )

  const commit = (result: GestureResult) => {
    if (result.kind === 'draw') {
      onDraw?.(result.day, result.range)
      return
    }
    if (result.kind === 'remove') {
      onChange(result.item.task, removeTime(result.item.task))
      return
    }
    if (result.kind === 'day') {
      onChange(result.item.task, planForDay(result.item.task, result.day))
      return
    }
    const { item } = result
    if (item.kind === 'event') {
      const to = result.kind === 'place' ? { day: result.day, ...result.range } : { day: item.day, ...result.range }
      onChangeEvent?.(item.event, to, { point: result.at })
      return
    }
    const { task } = item
    switch (result.kind) {
      case 'place': {
        const minutes = result.range.endMinute - result.range.startMinute
        onChange(task, placeBlock(task.due_date, atClock(result.day, result.range.startMinute), minutes))
        return
      }
      case 'start': {
        const block = blockOf(task)
        if (block) onChange(task, resizeBlockStart(task.due_date, block, atClock(item.day, result.range.startMinute)))
        return
      }
      case 'end': {
        const block = blockOf(task)
        if (block) onChange(task, resizeBlockEnd(block, atClock(item.day, result.range.endMinute)))
        return
      }
    }
  }

  const gesture = useTimelineGesture({
    days,
    today,
    scrollRef,
    gridRef,
    listRef,
    topRowRef,
    ignoreAt: (x, y) => turnAt(pageTurn, x, y) !== null,
    onCommit: commit,
    onPress: (item, element) => (item.kind === 'task' ? onPressBlock?.(item.task, element) : onPressEvent?.(item.event, element)),
  })

  const drop = useTimelineDrop({
    days,
    today,
    gridRef,
    scrollRef,
    lengthOf: (task) => lengthWhenPlaced(task, defaultLength),
    onPlace: (task, day, start, minutes) => onChange(task, placeBlock(task.due_date, atClock(day, start), minutes)),
  })

  // A block, an Event or a task on its way somewhere: Back and Forward turn the page, and for a task
  // the Day view's drop row shows.
  const dragging = gesture.moving !== null || drop.dragging
  const draggingTask = gesture.moving === 'task' || drop.dragging
  const draggingRef = useRef(dragging)
  draggingRef.current = dragging
  usePageTurnWhileDragging(dragging, multiDay ? undefined : pageTurn)

  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      drop.setNodeRef(node)
    },
    [drop.setNodeRef],
  )

  // Open at the useful part of the day once per day shown; a refresh never moves the scroll.
  const opened = useRef<string | null>(null)
  const openKey = days.join()
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller || isLoading || opened.current === openKey) return
    // A page turned during a drag keeps the hours in view, so the pointer stays over the same time.
    if (draggingRef.current) {
      opened.current = openKey
      return
    }
    const first = days.includes(today) ? today : selectedDay
    scroller.scrollTop = Math.max(0, openingMinute(first, now, today, clockMinutes(hours[0])) * PX_PER_MINUTE - OPENING_MARGIN_PX)
    opened.current = openKey
  }, [openKey, isLoading])

  /** Alt+Shift+Up or Down moves an Event 15 minutes, Shift+Up or Down changes its length, like a block. */
  const onEventKey = (item: EventGestureItem, key: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((key.key !== 'ArrowUp' && key.key !== 'ArrowDown') || !key.shiftKey) return
    const step = key.key === 'ArrowUp' ? -15 : 15
    const { startMinute, endMinute } = item.range
    const length = endMinute - startMinute
    let to: EventMove
    if (key.altKey) {
      const start = Math.max(0, Math.min(DAY_MINUTES - length, startMinute + step))
      to = { day: item.day, startMinute: start, endMinute: start + length }
    } else {
      to = { day: item.day, startMinute, endMinute: Math.max(startMinute + 15, Math.min(DAY_MINUTES, endMinute + step)) }
    }
    key.preventDefault()
    key.stopPropagation()
    if (to.startMinute === startMinute && to.endMinute === endMinute) return
    const element = key.currentTarget.closest('li')
    onChangeEvent?.(item.event, to, { element: element instanceof HTMLElement ? element : undefined })
  }

  const onKey = (task: Task, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const block = blockOf(task)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const element = event.currentTarget.closest('[data-plan-block]')
      if (element instanceof HTMLElement) onPressBlock?.(task, element)
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (!block || !canChange(task)) return
    const step = event.key === 'ArrowUp' ? -15 : 15
    if (event.altKey && event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      const start = Math.max(0, Math.min(DAY_MINUTES - block.minutes, minutesOfDay(block.start) + step))
      onChange(task, placeBlock(task.due_date, atClock(block.day, start), block.minutes))
    } else if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onChange(task, resizeBlockEnd(block, new Date(block.end.getTime() + step * 60_000)))
    }
  }

  const heading = formatDateDisplay('header.day', startOfLocalDay(selectedDay), now, true, fmt)
  const previewTarget = gesture.preview?.target
  const previewingTask = gesture.preview?.taskId
  const topOver = previewTarget?.kind === 'top' ? previewTarget.day : null

  // The Day view's row of tasks without a time: shown when the day has some, and as a drop target
  // while something is dragged.
  const singleDay = days[0]
  const singleDayTop = multiDay ? [] : dayTopRow(tasks, singleDay)
  const singleDayAllDay = multiDay ? NO_EVENTS : allDayEventsOn(events, singleDay)
  const dropRowOnly = !multiDay && singleDayTop.length === 0 && singleDayAllDay.length === 0 && draggingTask && canPlaceOn(singleDay, today)
  const dayTopRowView = (
    <DayTopRow
      day={singleDay}
      tasks={singleDayTop}
      allDay={singleDayAllDay}
      eventColor={eventColor}
      onPressEvent={onPressEvent}
      canDrop={canPlaceOn(singleDay, today)}
      canChange={canChange}
      highlighted={topOver === singleDay}
      wide
      emptyText="Drop here to remove the time"
      onDropTasks={(dropped) => {
        for (const task of dropped) onChange(task, planForDay(task, singleDay))
      }}
    />
  )

  return (
    <section aria-label="Day timeline" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p id={instructionsId} className="sr-only">
        Press Enter for lengths and nudges. Alt+Shift+Up or Down moves the block 15 minutes. Shift+Up or Down changes its length.
      </p>
      <p id={eventInstructionsId} className="sr-only">
        Press Enter to change the event. Alt+Shift+Up or Down moves it 15 minutes. Shift+Up or Down changes its length.
      </p>

      {multiDay && (
        <div className="shrink-0 border-b border-border pr-[var(--scrollbar-size)]">
          <div className="flex">
            <div className={GUTTER_CLASS} />
            {days.map((day) => {
              const date = startOfLocalDay(day)
              const selected = day === selectedDay
              return (
                <button
                  key={day}
                  type="button"
                  data-plan-day={day}
                  aria-pressed={selected}
                  onClick={() => onSelectDay(day)}
                  className={cn(
                    'min-w-0 flex-1 truncate border-l border-border px-2 py-1.5 text-left text-meta font-medium',
                    selected ? 'bg-bg-selected text-text' : 'text-text-secondary hover:bg-bg-hover',
                    day === today && 'text-accent-blue',
                  )}
                >
                  {date.toLocaleDateString(fmt.locale, { weekday: 'short', day: 'numeric' })}
                </button>
              )
            })}
          </div>
          <div ref={topRowRef} className="flex border-t border-border" aria-label="Tasks without a time">
            <div className={cn(GUTTER_CLASS, 'flex items-center justify-end pr-2 text-caption text-text-secondary')} />
            {days.map((day) => (
              <DayTopRow
                key={day}
                day={day}
                tasks={dayTopRow(tasks, day)}
                allDay={allDayEventsOn(events, day)}
                eventColor={eventColor}
                onPressEvent={onPressEvent}
                canDrop={canPlaceOn(day, today)}
                canChange={canChange}
                highlighted={topOver === day}
                onDropTasks={(dropped) => {
                  for (const task of dropped) onChange(task, planForDay(task, day))
                }}
              />
            ))}
          </div>
        </div>
      )}

      {!multiDay && (
        <div className="relative shrink-0">
          <div className="flex items-baseline gap-2 border-b border-border px-4 py-2">
            <h2 className="text-section text-text">{heading}</h2>
            <span className="truncate text-meta text-text-secondary">
              {startOfLocalDay(selectedDay).toLocaleDateString(fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' })}
              {note ? ` · ${note}` : canPlaceOn(selectedDay, today) && onDraw ? ' · drag on an empty slot to add a task' : ''}
            </span>
          </div>
          {/* Laid over the heading while a drag needs it, so the grid under the pointer does not move. */}
          {dropRowOnly && (
            <div ref={topRowRef} role="group" aria-label="Tasks without a time" className="absolute inset-0 z-30 flex border-b border-border bg-bg-page pr-[var(--scrollbar-size)]">
              <div className={GUTTER_CLASS} />
              {dayTopRowView}
            </div>
          )}
        </div>
      )}

      {!multiDay && (singleDayTop.length > 0 || singleDayAllDay.length > 0) && (
        <div ref={topRowRef} role="group" aria-label="Tasks without a time" className="flex shrink-0 border-b border-border pr-[var(--scrollbar-size)]">
          <div className={GUTTER_CLASS} />
          {dayTopRowView}
        </div>
      )}

      <div
        ref={setScroller}
        data-plan-scroller
        role="region"
        aria-label="Schedule"
        tabIndex={0}
        onScroll={drop.refresh}
        onKeyDown={(event) => {
          // Arrows on the timeline scroll it or change a block; they do not move the list's focus.
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation()
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        <div className="relative flex" style={{ height: DAY_MINUTES * PX_PER_MINUTE }}>
          <div className={cn(GUTTER_CLASS, 'relative')} aria-hidden="true">
            {HOURS.map((hour) =>
              hour === 0 ? null : (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 whitespace-nowrap text-caption text-text-secondary"
                  style={{ top: hour * HOUR_HEIGHT_PX }}
                >
                  {hourLabel(hour, fmt)}
                </span>
              ),
            )}
          </div>

          <div ref={gridRef} data-plan-grid className="relative flex min-w-0 flex-1">
            {days.map((day) => {
              const laid = layoutWithEvents(dayBlocks(tasks, day), timedEventsOn(events, day))
              const blocks = laid.blocks
              const markers = dayMarkers(tasks, day)
              const placeable = canPlaceOn(day, today)
              const isToday = day === today
              const workFrom = clockMinutes(hours[0])
              const workTo = clockMinutes(hours[1])
              return (
                <div
                  key={day}
                  data-plan-column={day}
                  onPointerDown={(event) => {
                    if (!placeable || !onDraw || draft) return
                    gesture.begin(event, 'draw', day, null)
                  }}
                  className={cn(
                    'relative min-w-0 flex-1 border-l border-border',
                    placeable && onDraw && !draft && 'cursor-crosshair',
                    !placeable && 'bg-bg-hover/40',
                  )}
                >
                  {/* Outside the work hours is shaded. */}
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 bg-bg-hover/40" style={{ height: workFrom * PX_PER_MINUTE }} />
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-bg-hover/40" style={{ top: workTo * PX_PER_MINUTE }} />
                  {HOURS.map((hour) => (
                    <div key={hour} aria-hidden="true" className="pointer-events-none absolute inset-x-0" style={{ top: hour * HOUR_HEIGHT_PX, height: HOUR_HEIGHT_PX }}>
                      {hour > 0 && <div className="absolute inset-x-0 top-0 border-t border-border" />}
                      <div className="absolute inset-x-0 border-t border-border/40" style={{ top: HOUR_HEIGHT_PX / 2 }} />
                    </div>
                  ))}

                  {routines
                    .filter((routine) => routine.day === day)
                    .map((routine) => (
                      <div
                        key={routine.key}
                        data-plan-routine={routine.key}
                        title={routine.name}
                        className={cn(
                          'pointer-events-none absolute right-1 z-[1] flex max-w-[45%] -translate-y-1/2 items-center gap-1 rounded-full border border-border bg-bg-card px-1.5 py-0.5 text-caption text-text-secondary',
                          routine.done && 'line-through',
                        )}
                        style={{ top: routine.minute * PX_PER_MINUTE }}
                      >
                        <HeartPulse className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{routine.name}</span>
                      </div>
                    ))}

                  <ol aria-label="Scheduled tasks" className="absolute inset-0 pointer-events-none">
                    {markers.map(({ task, minute }) => {
                      const editable = canChange(task) && placeable
                      const color = projectColor.get(task.project_id) ?? null
                      const start = atClock(day, minute)
                      const item: GestureItem = { kind: 'task', task, day, range: { startMinute: minute, endMinute: minute + defaultLength }, hasBlock: false }
                      const overBlock = markerOverBlock(minute, [...blocks, ...laid.events])
                      return (
                        <li
                          key={task.id}
                          data-plan-marker={task.id}
                          onPointerDown={(event) => {
                            event.stopPropagation()
                            if (editable) gesture.begin(event, 'move', day, item)
                          }}
                          data-plan-marker-over={overBlock || undefined}
                          className={cn(
                            'pointer-events-auto absolute flex h-5 items-center gap-1 touch-none select-none',
                            overBlock ? 'right-1 z-[2] max-w-[45%] rounded-full border border-border bg-bg-card px-1.5' : 'inset-x-0.5',
                            editable && 'cursor-grab',
                            gesture.preview?.taskId === task.id && 'opacity-30',
                          )}
                          style={{ top: minute * PX_PER_MINUTE - 10 }}
                        >
                          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border-2 border-accent-blue bg-bg-card" style={{ borderColor: color ?? undefined }} />
                          <button type="button" data-plan-focus onClick={(event) => {
                              // By keyboard; a press goes through the gesture above.
                              if (event.detail === 0) onPressBlock?.(task, event.currentTarget)
                            }} aria-label={`${task.title}, due ${formatDateDisplay('logbook.time', start, now, false, fmt)}`} className="min-w-0 truncate rounded-control text-caption text-text">
                            {task.title}
                          </button>
                        </li>
                      )
                    })}

                    {laid.events.map((placed) => {
                      const event = placed.event
                      // Only on the day it starts, and when it ends by midnight: the part after
                      // midnight of a late Event opens, it does not move.
                      const whole =
                        toLocalDate(new Date(event.start)) === day &&
                        new Date(event.end).getTime() <= startOfLocalDay(addLocalDays(day, 1)).getTime()
                      const editable = !draft && placeable && whole && canChangeEvent?.(event) === true
                      const item: EventGestureItem = { kind: 'event', event, day, range: { startMinute: placed.startMinute, endMinute: placed.endMinute } }
                      return (
                        <EventView
                          key={event.id}
                          event={event}
                          top={placed.startMinute * PX_PER_MINUTE}
                          height={placed.drawnMinutes * PX_PER_MINUTE - 1}
                          left={`calc(${(placed.column / placed.columnCount) * 100}% + 2px)`}
                          width={`calc(${100 / placed.columnCount}% - 4px)`}
                          range={formatBlockRange(new Date(event.start), new Date(event.end), fmt)}
                          color={eventColor?.(event.calendarId) ?? CALENDAR_COLORS[0]}
                          onPress={onPressEvent}
                          editable={editable}
                          hidden={gesture.preview?.eventId === event.id || pendingEvent?.id === event.id}
                          instructionsId={eventInstructionsId}
                          onGrab={(pointer) => {
                            const box = pointer.currentTarget.getBoundingClientRect()
                            gesture.begin(pointer, grabMode(pointer.clientY - box.top, box.height, true), day, item)
                          }}
                          onKey={(key) => onEventKey(item, key)}
                        />
                      )
                    })}

                    {blocks.map((placed) => {
                      const { task, block, startMinute, drawnMinutes, column, columnCount } = placed
                      const editable = canChange(task)
                      const height = drawnMinutes * PX_PER_MINUTE - 1
                      const realRange: GestureRange = { startMinute: minutesOfDay(block.start), endMinute: minutesOfDay(block.start) + block.minutes }
                      const item: GestureItem = { kind: 'task', task, day, range: realRange, hasBlock: true }
                      return (
                          <BlockView
                            key={task.id}
                            task={task}
                            top={startMinute * PX_PER_MINUTE}
                            height={height}
                            left={`calc(${(column / columnCount) * 100}% + 2px)`}
                            width={`calc(${100 / columnCount}% - 4px)`}
                            range={formatBlockRange(block.start, block.end, fmt)}
                            color={projectColor.get(task.project_id) ?? null}
                            editable={editable}
                            dashed={dashedIds?.has(task.id) === true}
                            draft={draft}
                            reason={reasonOf?.(task)}
                            hidden={previewingTask === task.id}
                            instructionsId={instructionsId}
                            onPointerDown={(event) => {
                              if (!editable) {
                                // A view-only block still opens for a look, and never starts a drawing.
                                event.stopPropagation()
                                if (event.button === 0) onPressBlock?.(task, event.currentTarget)
                                return
                              }
                              const box = event.currentTarget.getBoundingClientRect()
                              const mode = grabMode(event.clientY - box.top, box.height, true)
                              gesture.begin(event, mode, day, item)
                            }}
                            onKey={(event) => onKey(task, event)}
                          />
                      )
                    })}
                  </ol>

                  {previewTarget?.kind === 'grid' && previewTarget.day === day && (
                    <div
                      aria-hidden="true"
                      data-plan-preview
                      className="pointer-events-none absolute inset-x-0.5 z-20 flex items-start rounded-control border border-dashed border-accent-blue bg-accent-blue/15 px-1.5 py-0.5 text-caption text-text shadow-sm"
                      style={{
                        top: previewTarget.range.startMinute * PX_PER_MINUTE,
                        height: (previewTarget.range.endMinute - previewTarget.range.startMinute) * PX_PER_MINUTE,
                      }}
                    >
                      {formatBlockRange(atClock(day, previewTarget.range.startMinute), atClock(day, previewTarget.range.endMinute), fmt)}
                    </div>
                  )}

                  {pendingEvent?.day === day && (
                    <div
                      aria-hidden="true"
                      data-plan-event-pending
                      className="pointer-events-none absolute inset-x-0.5 z-20 flex items-start rounded-control border border-dashed border-accent-blue bg-accent-blue/15 px-1.5 py-0.5 text-caption text-text"
                      style={{
                        top: pendingEvent.startMinute * PX_PER_MINUTE,
                        height: (pendingEvent.endMinute - pendingEvent.startMinute) * PX_PER_MINUTE,
                      }}
                    >
                      {formatBlockRange(atClock(day, pendingEvent.startMinute), atClock(day, pendingEvent.endMinute), fmt)}
                    </div>
                  )}

                  {drop.hover?.day === day && (
                    <div
                      aria-hidden="true"
                      data-plan-drop-preview
                      className="pointer-events-none absolute inset-x-0.5 z-20 flex items-start rounded-control border border-dashed border-accent-blue bg-accent-blue/15 px-1.5 py-0.5 text-caption text-text"
                      style={{
                        top: drop.hover.minute * PX_PER_MINUTE,
                        height: lengthWhenPlaced(drop.hover.tasks[0], defaultLength) * PX_PER_MINUTE,
                      }}
                    >
                      {formatBlockRange(
                        atClock(day, drop.hover.minute),
                        atClock(day, drop.hover.minute + lengthWhenPlaced(drop.hover.tasks[0], defaultLength)),
                        fmt,
                      )}
                    </div>
                  )}

                  {drawn?.day === day && (
                    <div
                      ref={drawnRef as RefObject<HTMLDivElement>}
                      aria-hidden="true"
                      data-plan-drawn
                      className="pointer-events-none absolute inset-x-0.5 z-20 rounded-control border border-dashed border-accent-blue bg-accent-blue/15"
                      style={{
                        top: drawn.range.startMinute * PX_PER_MINUTE,
                        height: (drawn.range.endMinute - drawn.range.startMinute) * PX_PER_MINUTE,
                      }}
                    />
                  )}

                  {isToday && (
                    <div
                      aria-hidden="true"
                      data-plan-now
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-status-overdue"
                      style={{ top: minutesOfDay(now) * PX_PER_MINUTE }}
                    >
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-status-overdue" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
