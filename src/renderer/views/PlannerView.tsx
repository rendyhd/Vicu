import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { NewTaskComposer } from '@/components/task-list/NewTaskComposer'
import { useCalDavEvents } from '@/hooks/use-caldav'
import { DayViewCalendar } from '@/components/planner/DayViewCalendar'
import { Switch } from '@/components/shared/Switch'
import { Button } from '@/components/shared/Button'
import { DueDateContextProvider } from '@/components/task-list/TaskDueBadge'
import { useAppConfig } from '@/hooks/use-app-config'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useRoutines } from '@/hooks/use-routines'
import { useDateFormat } from '@/hooks/use-date-format'
import { useDayKey } from '@/stores/day-store'
import { usePrintable } from '@/stores/print-store'
import { cn } from '@/lib/cn'
import { formatDateDisplay } from '@/lib/date-display'
import { addLocalDays, startOfLocalDay, toLocalDate, type LocalDate } from '@/lib/due-dates'
import { openCount } from '@/lib/list-sections'
import { groupPlannerTasks, plannerCalendarDate, plannerTaskFilter, plannerUnplannedTasks, plannerVisibleDayCount, type PlannerDay } from '@/lib/planner'
import { plannerCalendarEvents } from '@/lib/planner-calendar'
import { isRoutinesEnabled, type Project, type TaskQueryParams } from '@/lib/vikunja-types'

interface PlannerColumnDay extends PlannerDay {
  label: string
}

interface PlannerDayColumnProps {
  day: PlannerColumnDay
  projectsById: ReadonlyMap<number, Project>
  isLoading: boolean
  /** This column's day is the one the right-side day calendar shows. */
  selected?: boolean
  onSelect?: (date: LocalDate) => void
  showUnplanned?: boolean
  onShowUnplannedChange?: (show: boolean) => void
  composer?: ReactNode
}

function PlannerDayColumn({
  day,
  projectsById,
  isLoading,
  selected = false,
  onSelect,
  showUnplanned = false,
  onShowUnplannedChange,
  composer,
}: PlannerDayColumnProps) {
  const columnId = `planner-column-${day.date ?? 'overdue'}`
  const date = day.date
  const { setNodeRef, isOver } = useDroppable({
    id: columnId,
    data: { type: 'planner-day', date: day.date },
    disabled: day.date === null,
  })

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={columnId}
      className={cn(
        'min-w-0 self-start overflow-hidden rounded-card border border-border bg-bg-card transition-colors duration-fade-fast',
        isOver && 'bg-accent-blue/5 ring-2 ring-inset ring-accent-blue',
      )}
    >
      <header className="flex h-12 items-center gap-2 border-b border-border px-4">
        <h2 id={columnId} className="min-w-0 flex-1">
          {date === null ? (
            <span
              className={cn(
                'block truncate text-section',
                !showUnplanned ? 'text-status-overdue' : 'text-text',
              )}
            >
              {day.label}
            </span>
          ) : (
            <button
              type="button"
              aria-current={selected ? 'date' : undefined}
              onClick={() => onSelect?.(date)}
              title="Show this day in the calendar"
              className={cn(
                '-mx-2 block w-full truncate rounded-control px-2 text-left text-section transition-colors duration-fade-fast hover:bg-bg-hover',
                selected ? 'text-accent-blue' : 'text-text',
              )}
            >
              <time dateTime={date}>{day.label}</time>
            </button>
          )}
        </h2>
        {day.date === null ? (
          <Switch
            aria-label="Show unplanned tasks"
            checked={showUnplanned}
            onCheckedChange={(show) => onShowUnplannedChange?.(show)}
          />
        ) : !isLoading && (
          <span className="shrink-0 text-meta text-text-secondary">{openCount(day.tasks)}</span>
        )}
      </header>

      {composer}
      {isLoading ? (
        <div aria-hidden="true" className="px-4 py-2">
          {['w-3/5', 'w-2/5', 'w-1/2'].map((width) => (
            <div key={width} className="flex items-center gap-3 py-2.5">
              <span className="vicu-shimmer h-5 w-5 shrink-0 rounded-full bg-bg-hover" />
              <span className={`vicu-shimmer h-3.5 rounded-control bg-bg-hover ${width}`} />
            </div>
          ))}
        </div>
      ) : day.tasks.length > 0 ? (
        <DueDateContextProvider value={day.date === null ? 'row' : 'row.inDayGroup'}>
          <TaskRowGroup>
            {day.tasks.map((task) => {
              const project = projectsById.get(task.project_id)
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  projectMeta={{ title: project?.title ?? 'Unknown Project', color: project?.hex_color }}
                  trailing="duration"
                />
              )
            })}
          </TaskRowGroup>
        </DueDateContextProvider>
      ) : !composer && (
        <p className="px-4 py-8 text-center text-meta text-text-secondary">No tasks</p>
      )}
    </section>
  )
}

export function PlannerView() {
  const [showUnplanned, setShowUnplanned] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: config } = useAppConfig()
  const inboxProjectId = config?.inbox_project_id
  const routinesEnabled = !!config && isRoutinesEnabled(config)
  const routines = useRoutines({ enabled: routinesEnabled })
  const startAdding = useCallback(() => {
    setShowUnplanned(true)
    setIsAdding(true)
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    if (isAdding) inputRef.current?.focus()
  }, [isAdding])
  // Null follows today at midnight; navigating pins the displayed range to a local date.
  const [firstDay, setFirstDay] = useState<LocalDate | null>(null)
  const [selectedDay, setSelectedDay] = useState<LocalDate | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const [visibleDayCount, setVisibleDayCount] = useState(1)
  useLayoutEffect(() => {
    const viewport = boardRef.current?.closest('[data-scroll-area]')
    if (!(viewport instanceof HTMLElement)) return
    // Include any scrollbar: a long day must not flip the column count at a breakpoint.
    const update = () => setVisibleDayCount(plannerVisibleDayCount(viewport.offsetWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  const dayKey = useDayKey()
  const now = useMemo(() => new Date(), [dayKey])
  const windowStartDate = firstDay ?? toLocalDate(now)
  const windowStart = useMemo(() => startOfLocalDay(windowStartDate), [windowStartDate])
  const moveDays = (offset: number) => {
    setFirstDay((current) => addLocalDays(current ?? toLocalDate(now), offset))
    setSelectedDay(null)
  }
  const params = useMemo<TaskQueryParams>(() => ({
    filter: plannerTaskFilter(windowStart),
    sort_by: 'start_date',
    order_by: 'asc',
  }), [windowStart])
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(params)
  const { data: projectData, isLoading: projectsLoading } = useProjects()
  const dateFormat = useDateFormat()
  const isLoading = tasksLoading || projectsLoading

  const projectsById = useMemo(
    () => new Map(projectData?.flat.map((project) => [project.id, project]) ?? []),
    [projectData?.flat],
  )
  const activeProjectIds = useMemo(() => new Set(projectsById.keys()), [projectsById])
  const unplannedTasks = useMemo(
    () => plannerUnplannedTasks(tasks, activeProjectIds),
    [tasks, activeProjectIds],
  )
  const days = useMemo(
    () => groupPlannerTasks(tasks, activeProjectIds, now, windowStartDate).map((day) => ({
      ...day,
      tasks: day.date === null && showUnplanned ? unplannedTasks : day.tasks,
      label: day.date === null
        ? (showUnplanned ? 'Unplanned' : 'Overdue')
        : formatDateDisplay('header.day', startOfLocalDay(day.date), now, true, dateFormat),
    })),
    [tasks, activeProjectIds, unplannedTasks, showUnplanned, now, windowStartDate, dateFormat],
  )
  // The picked heading, or the first day of the displayed range (docs/calendar.md).
  const calendarDate = plannerCalendarDate(selectedDay, windowStart, visibleDayCount)
  const calendarDay = useMemo(() => startOfLocalDay(calendarDate), [calendarDate])
  const caldav = useCalDavEvents(calendarDate)
  const calendarEvents = useMemo(
    () => plannerCalendarEvents(tasks, activeProjectIds, calendarDay, routinesEnabled ? routines.carriers : [], dayKey),
    [tasks, activeProjectIds, calendarDay, routinesEnabled, routines.carriers, dayKey],
  )

  usePrintable(useMemo(() => ({
    viewTitle: 'Planner',
    sections: days.map((day) => ({
      heading: day.label,
      groups: [{ tasks: day.tasks }],
    })),
  }), [days]))

  return (
    <DueDateContextProvider value="row.inDayGroup">
      <TaskList
        title="Planner"
        headerActions={(
          <div role="group" aria-label="Planner date navigation" className="flex items-center gap-1">
            <Button variant="quiet" className="h-7 w-7 p-0" aria-label="Previous day" title="Previous day" onClick={() => moveDays(-1)}>
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </Button>
            <Button variant="quiet" className="px-2" onClick={() => {
              setFirstDay(null)
              setSelectedDay(null)
            }}>
              Today
            </Button>
            <Button variant="quiet" className="h-7 w-7 p-0" aria-label="Next day" title="Next day" onClick={() => moveDays(1)}>
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        )}
        tasks={[]}
        showNewTask={false}
        onNewTask={inboxProjectId && activeProjectIds.has(inboxProjectId) ? startAdding : undefined}
        empty={false}
        wide
        scrollClassName="[scrollbar-gutter:auto]"
      >
        {isLoading && <span role="status" className="sr-only">Loading Planner</span>}
        {/* Only the day cards have padding. The rail fills the scroll viewport edge to edge. */}
        <div ref={boardRef} aria-busy={isLoading} className="flex w-full items-start">
          <div
            className="grid min-w-0 flex-1 items-start gap-4 px-6 pb-6 pt-2"
            style={{ gridTemplateColumns: `repeat(${visibleDayCount + 1}, minmax(0, 1fr))` }}
          >
            {days.slice(0, visibleDayCount + 1).map((day) => (
              <PlannerDayColumn
                key={day.date ?? 'overdue'}
                day={day}
                projectsById={projectsById}
                isLoading={isLoading}
                selected={day.date === calendarDate}
                onSelect={setSelectedDay}
                showUnplanned={showUnplanned}
                onShowUnplannedChange={(show) => {
                  setShowUnplanned(show)
                  if (!show) setIsAdding(false)
                }}
                composer={day.date === null && showUnplanned && isAdding && inboxProjectId ? (
                  <NewTaskComposer
                    projectId={inboxProjectId}
                    inputRef={inputRef}
                    onCancel={() => setIsAdding(false)}
                    onCreated={() => inputRef.current?.focus()}
                  />
                ) : undefined}
              />
            ))}
          </div>
          <DayViewCalendar day={calendarDay} events={calendarEvents} caldavEvents={caldav.data?.events}
            calendarErrors={caldav.error ? ['Could not load CalDAV calendars. Refresh to try again.'] : caldav.data?.errors}
            onRefresh={() => { void caldav.refetch() }}
            isLoading={isLoading || (routinesEnabled && routines.isLoading) || caldav.isLoading} className="w-80 max-w-[40%] shrink-0" />
        </div>
      </TaskList>
    </DueDateContextProvider>
  )
}
