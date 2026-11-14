import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Settings2, Sun } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { Button } from '@/components/shared/Button'
import { Popover } from '@/components/overlay/Popover'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { Timeline, type EventMove } from '@/components/planner/Timeline'
import { PlanMyDaySession } from '@/components/planner/PlanMyDay'
import { BlockPopover } from '@/components/planner/BlockPopover'
import { DrawTitle } from '@/components/planner/DrawTitle'
import { SourceChips } from '@/components/planner/SourceMenu'
import type { PageTurn, TurnDirection } from '@/components/planner/use-page-turn'
import { PlannerOptions } from '@/components/planner/PlannerOptions'
import { ImportCalendarHost } from '@/components/planner/ImportCalendarFile'
import { useAppConfig } from '@/hooks/use-app-config'
import { usePlanEventActions } from '@/hooks/use-plan-events'
import { usePlanBusy } from '@/hooks/use-plan-busy'
import { EventPopover } from '@/components/planner/EventPopover'
import { EventScopeMenu } from '@/components/planner/EventScopeMenu'
import type { CalendarEvent } from '../../shared/calendar-events'
import { MY_EVENTS_CALENDAR_ID, type EventEdit, type EventRepeat, type EventScope, type ListedEvent } from '../../shared/plan-events'
import type { DrawnKind, DrawnPlace } from '@/components/planner/DrawTitle'
import type { GesturePoint } from '@/components/planner/use-timeline-gesture'
import { useNewEventRequestStore } from '@/stores/new-event-request-store'
import { useDateFormat } from '@/hooks/use-date-format'
import { useFilters } from '@/hooks/use-filters'
import { useOpenTask } from '@/hooks/use-open-task'
import { usePlannerPrefs, usePlanRange, usePlanRoutines, useSavePlannerConfig, toTaskChanges } from '@/hooks/use-planner'
import { useProjectAccessMap } from '@/hooks/use-project-access'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useCreateTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { api } from '@/lib/api'
import { formatDateDisplay, midSentence } from '@/lib/date-display'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { useDayKey } from '@/stores/day-store'
import { announce } from '@/stores/announcer-store'
import { useNewTaskRequestStore } from '@/stores/new-task-request-store'
import { toast } from '@/stores/toast-store'
import { canPlaceOn, dayWithoutTime, formatLength, plannedMinutes, type GestureRange } from '@/lib/planner-timeline'
import {
  drawTargetProject,
  inNextSevenDays,
  matchesTitleFilter,
  readPlanSource,
  sourceProjectId,
  type PlanSource,
} from '@/lib/plan-source'
import { isPlannerEnabled, type CreateTaskPayload, type Task } from '@/lib/vikunja-types'
import { addLocalDays, dateOnlyDue, isNoDueDate, localDateOf, startOfLocalDay, startOfWeek, toLocalDate, type LocalDate } from '../../shared/due-dates'
import { withDefaultReminder } from '../../shared/default-reminder'
import { withoutNestedSubtasks } from '../../shared/nested-subtasks'
import { useAvailability } from '@/hooks/use-availability'
import { confirmDelete } from '@/lib/confirm-bridge'
import { blockReplacesLaterStart, startDateOf } from '../../shared/pro/start-dates'
import { formatWeekdayDate } from '../../shared/date-display'
import {
  atClock,
  blockOf,
  busyOfDay,
  clockMinutes,
  clockText,
  fitTasks,
  minutesOfDay,
  freeMinutes,
  moveBlockToDay,
  nextFreeSlot,
  placeBlock,
  viewDays,
  type BlockChanges,
  type PlanViewKind,
} from '../../shared/time-blocks'
import { useWeekStart } from '@/hooks/use-week-start'

const VIEWS: { value: PlanViewKind; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: '3days', label: '3 days' },
  { value: 'week', label: 'Week' },
]

const STEP: Record<PlanViewKind, number> = { day: 1, '3days': 3, week: 7 }

const SHOW_PROJECT = { showProject: true }

/** The Plan screen (contract 16, design direction D2): tasks to plan on the left, the timeline on the right. */
export function PlanView() {
  const { data: config, isLoading } = useAppConfig()
  if (isLoading) return null
  if (!isPlannerEnabled(config)) return <Navigate to="/today" />
  return <PlanScreen />
}

function PlanScreen() {
  const { data: config } = useAppConfig()
  const save = useSavePlannerConfig()
  const fmt = useDateFormat()
  const prefs = usePlannerPrefs()
  const dayKey = useDayKey()
  const today = toLocalDate(new Date())
  const inboxId = config?.inbox_project_id ?? 0

  const view: PlanViewKind = config?.planner_view === '3days' || config?.planner_view === 'week' ? config.planner_view : 'day'
  const [anchorDay, setAnchorDay] = useState(today)
  const [selectedDay, setSelectedDay] = useState(today)
  // The week view shows the account's week (contract section 2.1).
  const weekStart = useWeekStart()
  const weekOf = useCallback((day: LocalDate) => startOfWeek(day, weekStart), [weekStart])
  const days = useMemo(() => viewDays(view, anchorDay, weekOf), [view, anchorDay, weekOf])
  const source = readPlanSource(config?.planner_source)

  const setView = (next: PlanViewKind) => {
    setAnchorDay(selectedDay)
    save({ planner_view: next })
  }
  const go = (direction: 1 | -1) => {
    const next = addLocalDays(view === 'week' ? weekOf(anchorDay) : anchorDay, direction * STEP[view])
    setAnchorDay(next)
    setSelectedDay(view === 'week' ? (viewDays('week', next, weekOf).includes(today) ? today : next) : next)
  }
  const goToday = () => {
    setAnchorDay(today)
    setSelectedDay(today)
  }
  /** Show a day: selected where it is on screen, else the view moves to it. */
  const selectDay = (day: LocalDate) => {
    if (!days.includes(day)) setAnchorDay(day)
    setSelectedDay(day)
  }

  const range = usePlanRange(days)
  // Your own Events and the connected calendars' events, on one timeline, and their busy time.
  const busy = usePlanBusy(days)
  const allEvents = busy.events
  const planEventActions = usePlanEventActions()
  /** Busy time of a day (contract 16.6 and 20.2): its open blocks and the events that count. */
  const busyOn = (day: LocalDate) => [...busyOfDay(range.tasks, day), ...busy.eventBusyOn(day)]
  // A pressed event's popover, by occurrence id so it shows the event as it is now. `press` names
  // one press: a change that moves the occurrence to a new Event keeps the same popover open.
  const [pressedEvent, setPressedEvent] = useState<{ id: string; element: HTMLElement; press: number; anchor: number } | null>(null)
  // Which times the popover's changes are for; kept when it opens again at a split's new Event.
  const [eventScope, setEventScope] = useState<EventScope>('all')
  const lastPressed = useRef<CalendarEvent | undefined>(undefined)
  const found = pressedEvent ? allEvents.find((event) => event.id === pressedEvent.id) : undefined
  if (found) lastPressed.current = found
  // Between a write and the next render the occurrence may be under its new id already: the last
  // one seen stands in for that moment.
  const pressedOccurrence: CalendarEvent | undefined = pressedEvent ? (found ?? lastPressed.current) : undefined
  const planEventOf = (occurrence: CalendarEvent): ListedEvent | undefined =>
    occurrence.calendarId === MY_EVENTS_CALENDAR_ID ? busy.planEvents.find((event) => event.id === occurrence.planEventId) : undefined
  const pressEvent = (event: CalendarEvent, element: HTMLElement) => {
    setPressed(null)
    lastPressed.current = event
    setEventScope('all')
    setPressedEvent((current) => ({ id: event.id, element, press: (current?.press ?? 0) + 1, anchor: 0 }))
  }
  /**
   * The popover follows the occurrence to the Event a change moved it to, and opens again next to
   * its new place (a popover keeps the anchor it opened at).
   */
  const followOccurrence = (id: string) => {
    setPressedEvent((current) => (current ? { ...current, id } : current))
    requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-plan-event="${CSS.escape(id)}"]`)
      if (element) setPressedEvent((current) => (current?.id === id && current.element !== element ? { ...current, element, anchor: current.anchor + 1 } : current))
    })
  }

  // An Event moved or resized on the timeline (contract 20.6, 20.7). One that repeats asks which
  // times first; the move waits on the timeline, dashed, until the answer.
  const [pendingMove, setPendingMove] = useState<{
    planEvent: ListedEvent
    occurrence: CalendarEvent
    to: EventMove
    edit: EventEdit
    element?: HTMLElement
    point?: GesturePoint
  } | null>(null)
  const pendingAnchor = useRef<HTMLElement | null>(null)
  const applyMove = async (planEvent: ListedEvent, day: LocalDate, edit: EventEdit, scope: EventScope, refocus: boolean) => {
    const id = await planEventActions.change(planEvent, day, edit, scope)
    if (edit.day) selectDay(edit.day)
    // A keyboard change keeps the focus on the event, wherever it went.
    if (id && refocus) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-plan-event="${CSS.escape(id)}"] [data-plan-focus]`)?.focus({ preventScroll: true }))
    }
  }
  const moveEvent = (occurrence: CalendarEvent, to: EventMove, anchor: { element?: HTMLElement; point?: GesturePoint }) => {
    const planEvent = planEventOf(occurrence)
    if (!planEvent || !occurrence.day) return
    const edit: EventEdit = { time: clockText(to.startMinute), minutes: to.endMinute - to.startMinute }
    if (to.day !== occurrence.day) edit.day = to.day
    setPressedEvent(null)
    if (planEvent.repeat.kind === 'none') {
      void applyMove(planEvent, occurrence.day, edit, 'all', !!anchor.element)
      return
    }
    pendingAnchor.current = anchor.element ?? null
    setPendingMove({ planEvent, occurrence, to, edit, ...anchor })
  }
  const update = useUpdateTask()
  const create = useCreateTask()
  const proStarts = useAvailability().on
  const dateFormat = useDateFormat()
  const openTask = useOpenTask()
  const access = useProjectAccessMap()
  const { data: projects } = useProjects()
  const canWriteProject = (id: number) => (access.get(id)?.permission ?? 1) > 0

  const change = (task: Task, changes: BlockChanges, announceDue = true) => {
    const write = () => {
      update.mutate({ id: task.id, changes: toTaskChanges(changes), original: task })
      if (announceDue) announceDueMove(task, changes)
    }
    // Pro (decision 17, 21.3): a block replaces a later start date; say so first.
    const start = proStarts && changes.start_date ? new Date(changes.start_date) : null
    const later = start ? startDateOf(task) : null
    if (start && later && blockReplacesLaterStart(task, start)) {
      void confirmDelete(`This task starts ${formatWeekdayDate(later, new Date(), dateFormat)}. Planning it earlier replaces that date.`, {
        force: true,
        confirmLabel: 'Plan it',
        destructive: false,
      }).then((ok) => ok && write())
      return
    }
    write()
  }

  /**
   * A block placed or moved whose due rule (16.2) moved the due date to another day says so, with
   * Undo: the one change nobody dragged. The phone says the same (`PlanViewModel.announceDueMove`).
   */
  const announceDueMove = (task: Task, changes: BlockChanges) => {
    if (!changes.start_date || !changes.due_date || isNoDueDate(task.due_date)) return
    const from = localDateOf(task.due_date)
    const to = localDateOf(changes.due_date)
    if (from === to) return
    toast.success(`Planned for ${midSentence(dayPhrase(to))}. Due date moved from ${midSentence(dayPhrase(from))}`, {
      action: {
        label: 'Undo',
        onAction: () => {
          update.mutate({
            id: task.id,
            changes: { start_date: task.start_date, end_date: task.end_date, due_date: task.due_date },
            original: { ...task, ...toTaskChanges(changes) },
          })
        },
      },
    })
  }

  /** The popover's Day row (contract 16.2): the same times on that day, which the view then shows. */
  const moveToDay = (task: Task, day: LocalDate) => {
    const changes = moveBlockToDay(task, day)
    if (!changes) return
    change(task, changes, false)
    selectDay(day)
    toast.success(`Moved to ${midSentence(dayPhrase(day))}`, {
      action: {
        label: 'Undo',
        onAction: () => {
          // The patch is the difference with the task as the move left it: back to what it was.
          update.mutate({
            id: task.id,
            changes: { start_date: task.start_date, end_date: task.end_date, due_date: task.due_date },
            original: { ...task, ...toTaskChanges(changes) },
          })
        },
      },
    })
  }

  // Day view: a drag resting on Back or Forward turns the page, never onto a past day.
  const prevRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const [turnHover, setTurnHover] = useState<TurnDirection | null>(null)
  const pageTurn: PageTurn | undefined =
    view === 'day'
      ? {
          prevRef,
          nextRef,
          canTurn: (direction) => canPlaceOn(addLocalDays(anchorDay, direction), today),
          onTurn: go,
          onHover: setTurnHover,
        }
      : undefined

  // The left panel's list.
  const heldTasks = useCompletedTasksStore((s) => s.tasks)
  const projectSourceId = sourceProjectId(source, inboxId) ?? undefined
  const project = useProjectTasks(projectSourceId)
  // Only what is cached: a list that is not shown is never fetched for its count.
  const inboxCached = useProjectTasks(inboxId || undefined, false)
  const upcomingParams = useFilters({ view: 'upcoming' })
  const anytimeParams = useFilters({ view: 'anytime' })
  const upcoming = useTasks(upcomingParams, source === 'next7')
  const anytime = useTasks(anytimeParams, source === 'nodate')
  const [filter, setFilter] = useState('')

  const dayTasks = useMemo(
    () => withoutNestedSubtasks(dayWithoutTime(range.tasks, selectedDay, new Date(), (task) => heldTasks.has(task.id))),
    [range.tasks, selectedDay, heldTasks, dayKey],
  )
  const nextSevenTasks = useMemo(() => upcoming.data.filter((task) => inNextSevenDays(task.due_date, today)), [upcoming.data, today, dayKey])
  const noDateTasks = useMemo(
    () => anytime.data.filter((task) => isNoDueDate(task.due_date) && task.project_id !== inboxId),
    [anytime.data, inboxId],
  )
  const sourceTasks = useMemo(() => {
    switch (source) {
      case 'day':
        return dayTasks
      case 'next7':
        return nextSevenTasks
      case 'nodate':
        return noDateTasks
      default:
        return project.data
    }
  }, [source, dayTasks, nextSevenTasks, noDateTasks, project.data])
  const listed = useMemo(() => sourceTasks.filter((task) => matchesTitleFilter(task.title, filter)), [sourceTasks, filter])

  // Each chip's count, where the data is at hand. A list never loaded here or elsewhere has none.
  const sourceCounts = {
    day: range.isLoading ? undefined : dayTasks.length,
    inbox: source === 'inbox' ? (project.isSuccess ? project.data.length : undefined) : inboxCached.isSuccess ? inboxCached.data.length : undefined,
    next7: upcoming.isSuccess ? nextSevenTasks.length : undefined,
    nodate: anytime.isSuccess ? noDateTasks.length : undefined,
  }
  const sourceProject = source.startsWith('project:') ? projects?.flat.find((candidate) => candidate.id === sourceProjectId(source, inboxId)) : undefined

  /** "Today", "Tomorrow", "Wed 12", "Mon, Nov 23" (the day header phrase, contract 8.3). */
  const dayPhrase = (day: LocalDate) => formatDateDisplay('header.day', startOfLocalDay(day), new Date(), true, fmt)

  const routines = usePlanRoutines(days)

  // Plan my day takes the place of the list and the views while it runs.
  const [inSession, setInSession] = useState(false)

  // A block's popover, by task id so it always shows the task as it is now.
  const [pressed, setPressed] = useState<{ id: number; element: HTMLElement } | null>(null)
  const pressedTask = pressed ? range.tasks.find((task) => task.id === pressed.id) : undefined

  // A drawn stretch, waiting for its title; `kind` is what the box starts as.
  const [drawn, setDrawn] = useState<{ day: LocalDate; range: GestureRange; kind?: DrawnKind } | null>(null)
  const drawnRef = useRef<HTMLDivElement | null>(null)
  const drawProject = drawTargetProject(source, inboxId, canWriteProject)
  const addDrawn = (title: string, kind: DrawnKind = 'task', repeat: EventRepeat = { kind: 'none' }, place?: DrawnPlace) => {
    if (!drawn) return
    if (kind === 'event') {
      // The quick-add text may name another day and time than the box was opened at.
      const at = place ?? { day: drawn.day, startMinute: drawn.range.startMinute, endMinute: drawn.range.endMinute }
      void planEventActions.add({
        title,
        start: at.day,
        time: clockText(at.startMinute),
        minutes: at.endMinute - at.startMinute,
        repeat,
      })
      if (at.day !== drawn.day) selectDay(at.day)
      setDrawn(null)
      return
    }
    const start = atClock(drawn.day, drawn.range.startMinute)
    const end = atClock(drawn.day, drawn.range.endMinute)
    const payload = withDefaultReminder(
      { title, due_date: dateOnlyDue(drawn.day), start_date: start.toISOString(), end_date: end.toISOString() },
      config,
    )
    create.mutate(
      { projectId: drawProject, task: payload as CreateTaskPayload },
      {
        onSuccess: () => announce(`Added ${title}`),
        onSettled: () => setDrawn(null),
      },
    )
  }

  // New task (Ctrl+N, File > New task, the palette): the title box at the selected day's next free
  // time. With none left the Inbox's composer takes the request, as in a view without a composer.
  const navigate = useNavigate()
  const newTaskRequestedAt = useNewTaskRequestStore((s) => s.requestedAt)
  useEffect(() => {
    return api.onNewTask(() => {
      if (!inSession) useNewTaskRequestStore.getState().request()
    })
  }, [inSession])
  useEffect(() => {
    if (newTaskRequestedAt === null || inSession) return
    const start = nextFreeSlot(new Date(), selectedDay, prefs.hours, prefs.defaultLength, busyOn(selectedDay))
    if (start === null) {
      void navigate({ to: '/inbox' })
      return
    }
    if (!useNewTaskRequestStore.getState().take()) return
    setPressed(null)
    setDrawn((current) => current ?? { day: selectedDay, range: { startMinute: start, endMinute: start + prefs.defaultLength } })
  }, [newTaskRequestedAt])
  // New event (the palette, Ctrl+Shift+N here): the same title box as Event, at the selected day's
  // next free time; a full day still takes it (an Event may overlap).
  const newEventRequestedAt = useNewEventRequestStore((s) => s.requestedAt)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        useNewEventRequestStore.getState().request()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
  useEffect(() => {
    if (newEventRequestedAt === null || inSession) return
    if (!useNewEventRequestStore.getState().take()) return
    const now = new Date()
    const free = nextFreeSlot(now, selectedDay, prefs.hours, prefs.defaultLength, busyOn(selectedDay))
    // No free time left: today the next quarter hour, another day the start of the work hours.
    const fallback = selectedDay === toLocalDate(now)
      ? Math.min(24 * 60 - prefs.defaultLength, Math.ceil(minutesOfDay(now) / 15) * 15)
      : clockMinutes(prefs.hours[0])
    const start = free ?? fallback
    setPressed(null)
    setPressedEvent(null)
    setDrawn((current) => current ?? { day: selectedDay, range: { startMinute: start, endMinute: Math.min(24 * 60, start + prefs.defaultLength) }, kind: 'event' })
  }, [newEventRequestedAt, inSession])
  // That time may be off screen; a stretch drawn by hand already shows.
  useEffect(() => {
    if (drawn) drawnRef.current?.scrollIntoView({ block: 'nearest' })
  }, [drawn])

  // Totals of the selected day.
  const now = new Date()
  const planned = plannedMinutes(range.tasks, selectedDay)
  const free = freeMinutes(now, selectedDay, prefs.hours, busyOn(selectedDay))

  const listRef = useRef<HTMLElement | null>(null)
  const [gearOpen, setGearOpen] = useState(false)
  const gearRef = useRef<HTMLButtonElement>(null)

  /** Fit (contract 16.6): the day's tasks without a time take the next free slots, with Undo. */
  const fitDay = () => {
    const candidates = dayWithoutTime(range.tasks, selectedDay, new Date()).filter((task) => canWriteProject(task.project_id))
    const fitted = fitTasks(candidates, {
      now: new Date(),
      day: selectedDay,
      hours: prefs.hours,
      busy: busyOn(selectedDay),
      lengthOf: (task) => blockOf(task)?.minutes ?? prefs.defaultLength,
    })
    if (fitted.length === 0) {
      toast.info('Nothing fits in the free time left.')
      return
    }
    const placed = fitted.map(({ task, start, end }) => {
      const changes = toTaskChanges(placeBlock(task.due_date, atClock(selectedDay, start), end - start))
      update.mutate({ id: task.id, changes, original: task })
      return { task, changes }
    })
    const left = candidates.length - fitted.length
    toast.success(
      `Planned ${fitted.length} ${fitted.length === 1 ? 'task' : 'tasks'}${left > 0 ? `, ${left} did not fit` : ''}`,
      {
        action: {
          label: 'Undo',
          onAction: () => {
            // The patch is the difference with the task as Fit left it: back to what it was.
            for (const { task, changes } of placed) {
              update.mutate({
                id: task.id,
                changes: { start_date: task.start_date, end_date: task.end_date, due_date: task.due_date },
                original: { ...task, ...changes },
              })
            }
          },
        },
      },
    )
  }

  const headerDay = (() => {
    const date = startOfLocalDay(selectedDay)
    const short = date.toLocaleDateString(fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' })
    return selectedDay === today ? `Today · ${short}` : short
  })()

  const rowView = useMemo(() => {
    const id = source.startsWith('project:') || source === 'inbox' ? sourceProjectId(source, inboxId) : null
    return id ? { projectId: id, showProject: true } : SHOW_PROJECT
  }, [source, inboxId])

  return (
    <div className="flex h-full min-h-0 flex-col" data-plan-screen>
      {/* Below the window's drag band, so every control can be pressed. */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 pb-3 pt-8">
        <div className="flex items-center gap-2">
          <SmartListIcon list="plan" className="h-5 w-5" />
          <h1 className="text-page-title text-text">Plan</h1>
        </div>
        {!inSession && <div role="radiogroup" aria-label="View" className="flex rounded-full border border-border p-0.5">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={view === option.value}
              data-plan-view={option.value}
              onClick={() => setView(option.value)}
              className={cn(
                'rounded-full px-3 py-0.5 text-meta font-medium',
                view === option.value ? 'bg-bg-selected text-text' : 'text-text-secondary hover:text-text',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>}
        {!inSession && <div className="flex items-center gap-0.5">
          <button
            ref={prevRef}
            type="button"
            aria-label="Back"
            data-plan-prev
            onClick={() => go(-1)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover',
              turnHover === -1 && 'bg-bg-selected text-text',
            )}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" data-plan-today onClick={goToday} className="rounded-control px-2 py-1 text-meta font-medium text-text hover:bg-bg-hover">
            Today
          </button>
          <button
            ref={nextRef}
            type="button"
            aria-label="Forward"
            data-plan-next
            onClick={() => go(1)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover',
              turnHover === 1 && 'bg-bg-selected text-text',
            )}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>}
        {!inSession && <p className="min-w-0 truncate text-meta text-text-secondary" data-plan-day-label>
          {headerDay}
        </p>}
        <div className="ml-auto flex items-center gap-2">
          {!inSession && (
            <Button variant="primary" data-plan-my-day onClick={() => setInSession(true)}>
              <Sun className="h-4 w-4" aria-hidden="true" />
              Plan my day
            </Button>
          )}
          <button
            ref={gearRef}
            type="button"
            aria-label="Plan settings"
            aria-expanded={gearOpen}
            data-plan-gear
            onClick={() => setGearOpen((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-control border border-border text-text-secondary hover:bg-bg-hover"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </button>
          <ImportCalendarHost />
          {gearOpen && (
            <Popover
              anchorRef={gearRef}
              invokedBy={[gearRef]}
              label="Plan settings"
              role="dialog"
              placement="bottom-end"
              onClose={() => setGearOpen(false)}
              className="w-80 p-3"
            >
              <PlannerOptions compact />
              <div className="mt-3 border-t border-border pt-3">
                <Button
                  variant="secondary"
                  data-plan-fit
                  onClick={() => {
                    setGearOpen(false)
                    fitDay()
                  }}
                >
                  Fit {selectedDay === today ? 'today' : dayPhrase(selectedDay)}
                </Button>
                <p className="mt-1 text-caption text-text-secondary">
                  Gives the tasks without a time the next free slots, most urgent first.
                </p>
              </div>
            </Popover>
          )}
        </div>
      </header>

      {inSession ? (
        <PlanMyDaySession listRef={listRef} onExit={() => setInSession(false)} />
      ) : (
      <div className="flex min-h-0 flex-1">
        <aside
          ref={listRef}
          aria-label="Tasks to plan"
          data-plan-panel
          className="flex w-[340px] shrink-0 flex-col border-r border-border"
        >
          <div className="shrink-0 space-y-2 p-3 pb-2">
            <SourceChips
              source={source}
              dayLabel={dayPhrase(selectedDay)}
              counts={sourceCounts}
              projectLabel={sourceProject?.title}
              projectCount={project.isSuccess ? project.data.length : undefined}
              inboxId={inboxId}
              onChange={(next: PlanSource) => save({ planner_source: next })}
            />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter these tasks"
              aria-label="Filter these tasks"
              data-plan-filter
              className="w-full rounded-control border border-border bg-transparent px-3 py-1.5 text-meta text-text placeholder:text-text-secondary"
            />
          </div>
          <div className="min-h-0 flex-1">
            <RowViewProvider value={rowView}>
              <TaskList
                title="Tasks to plan"
                hideHeader
                tasks={listed}
                showNewTask={false}
                emptyTitle={filter ? 'Nothing with that name' : 'Nothing to plan here'}
                emptySubtitle={filter ? undefined : 'Pick another list, or drag on the timeline to add a task.'}
              />
            </RowViewProvider>
          </div>
          <p className="shrink-0 border-t border-border px-3 py-2 text-meta text-text-secondary" data-plan-totals>
            {formatLength(planned)} planned · {formatLength(free)} free
          </p>
        </aside>

        <Timeline
          days={days}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          tasks={range.tasks}
          routines={routines}
          defaultLength={prefs.defaultLength}
          hours={prefs.hours}
          isLoading={range.isLoading}
          listRef={listRef}
          onChange={change}
          onPressBlock={(task, element) => setPressed({ id: task.id, element })}
          onDraw={(day, drawnRange) => {
            setPressed(null)
            setDrawn({ day, range: drawnRange })
          }}
          drawn={drawn}
          drawnRef={drawnRef}
          pageTurn={pageTurn}
          events={allEvents}
          eventColor={busy.eventColor}
          onPressEvent={pressEvent}
          canChangeEvent={(event) => planEventOf(event) !== undefined}
          onChangeEvent={moveEvent}
          pendingEvent={pendingMove ? { id: pendingMove.occurrence.id, ...pendingMove.to } : null}
        />
      </div>
      )}

      {pressed && pressedTask && (
        <BlockPopover
          key={pressed.id}
          task={pressedTask}
          element={pressed.element}
          canChange={canWriteProject(pressedTask.project_id)}
          defaultLength={prefs.defaultLength}
          onChange={change}
          onOpenTask={(task) => openTask(task.id)}
          onMoveToDay={moveToDay}
          onClose={() => setPressed(null)}
        />
      )}

      {pressedEvent && pressedOccurrence && (
        <EventPopover
          key={`${pressedEvent.press}-${pressedEvent.anchor}`}
          occurrence={pressedOccurrence}
          element={pressedEvent.element}
          planEvent={planEventOf(pressedOccurrence)}
          calendarName={busy.feeds.find((feed) => feed.id === pressedOccurrence.calendarId)?.name}
          defaultLength={prefs.defaultLength}
          onMoved={followOccurrence}
          scope={eventScope}
          onScopeChange={setEventScope}
          onClose={() => setPressedEvent(null)}
        />
      )}

      {pendingMove && (
        <EventScopeMenu
          anchorRef={pendingMove.point ? undefined : pendingAnchor}
          anchorPoint={pendingMove.point}
          title={pendingMove.planEvent.title}
          onChoose={(scope) => {
            const { planEvent, occurrence, edit, element } = pendingMove
            setPendingMove(null)
            void applyMove(planEvent, occurrence.day ?? planEvent.start, edit, scope, !!element)
          }}
          onCancel={() => {
            // Escape: nothing changes, and a keyboard change gives the focus back to the event.
            pendingMove.element?.querySelector<HTMLElement>('[data-plan-focus]')?.focus({ preventScroll: true })
            setPendingMove(null)
          }}
        />
      )}

      {drawn && (
        <DrawTitle
          anchorRef={drawnRef}
          day={drawn.day}
          start={atClock(drawn.day, drawn.range.startMinute)}
          end={atClock(drawn.day, drawn.range.endMinute)}
          initialKind={drawn.kind}
          projectName={projects?.flat.find((candidate) => candidate.id === drawProject)?.title}
          onSubmit={addDrawn}
          onCancel={() => setDrawn(null)}
        />
      )}
    </div>
  )
}
