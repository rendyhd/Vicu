import { useMemo, useRef, useState } from 'react'
import { Navigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Settings2, Sun } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { Button } from '@/components/shared/Button'
import { Popover } from '@/components/overlay/Popover'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { Timeline } from '@/components/planner/Timeline'
import { PlanMyDaySession } from '@/components/planner/PlanMyDay'
import { BlockPopover } from '@/components/planner/BlockPopover'
import { DrawTitle } from '@/components/planner/DrawTitle'
import { SourceMenu } from '@/components/planner/SourceMenu'
import { PlannerOptions } from '@/components/planner/PlannerOptions'
import { useAppConfig } from '@/hooks/use-app-config'
import { useDateFormat } from '@/hooks/use-date-format'
import { useFilters } from '@/hooks/use-filters'
import { useOpenTask } from '@/hooks/use-open-task'
import { usePlannerPrefs, usePlanRange, usePlanRoutines, useSavePlannerConfig, toTaskChanges } from '@/hooks/use-planner'
import { useProjectAccessMap } from '@/hooks/use-project-access'
import { useProjectTasks } from '@/hooks/use-project-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useTasks } from '@/hooks/use-tasks'
import { useCreateTask, useUpdateTask } from '@/hooks/use-task-mutations'
import { formatDateDisplay } from '@/lib/date-display'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { useDayKey } from '@/stores/day-store'
import { announce } from '@/stores/announcer-store'
import { toast } from '@/stores/toast-store'
import { dayWithoutTime, formatLength, plannedMinutes, type GestureRange } from '@/lib/planner-timeline'
import {
  dayListLabel,
  drawTargetProject,
  inNextSevenDays,
  matchesTitleFilter,
  readPlanSource,
  sourceLists,
  sourceProjectId,
  type PlanSource,
} from '@/lib/plan-source'
import { isPlannerEnabled, type CreateTaskPayload, type Task } from '@/lib/vikunja-types'
import { addLocalDays, dateOnlyDue, isNoDueDate, startOfLocalDay, startOfWeek, toLocalDate, type LocalDate } from '../../shared/due-dates'
import { withDefaultReminder } from '../../shared/default-reminder'
import { withoutNestedSubtasks } from '../../shared/nested-subtasks'
import {
  atClock,
  blockOf,
  busyOfDay,
  fitTasks,
  freeMinutes,
  placeBlock,
  viewDays,
  type BlockChanges,
  type PlanViewKind,
} from '../../shared/time-blocks'

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
  const days = useMemo(() => viewDays(view, anchorDay, startOfWeek), [view, anchorDay])
  const source = readPlanSource(config?.planner_source)

  const setView = (next: PlanViewKind) => {
    setAnchorDay(selectedDay)
    save({ planner_view: next })
  }
  const go = (direction: 1 | -1) => {
    const next = addLocalDays(view === 'week' ? startOfWeek(anchorDay) : anchorDay, direction * STEP[view])
    setAnchorDay(next)
    setSelectedDay(view === 'week' ? (viewDays('week', next, startOfWeek).includes(today) ? today : next) : next)
  }
  const goToday = () => {
    setAnchorDay(today)
    setSelectedDay(today)
  }

  const range = usePlanRange(days)
  const update = useUpdateTask()
  const create = useCreateTask()
  const openTask = useOpenTask()
  const access = useProjectAccessMap()
  const { data: projects } = useProjects()
  const canWriteProject = (id: number) => (access.get(id)?.permission ?? 1) > 0

  const change = (task: Task, changes: BlockChanges) => {
    update.mutate({ id: task.id, changes: toTaskChanges(changes), original: task })
  }

  // The left panel's list.
  const heldTasks = useCompletedTasksStore((s) => s.tasks)
  const projectSourceId = sourceProjectId(source, inboxId) ?? undefined
  const project = useProjectTasks(projectSourceId)
  const upcomingParams = useFilters({ view: 'upcoming' })
  const anytimeParams = useFilters({ view: 'anytime' })
  const upcoming = useTasks(upcomingParams, source === 'next7')
  const anytime = useTasks(anytimeParams, source === 'nodate')
  const [filter, setFilter] = useState('')

  const sourceTasks = useMemo(() => {
    const now = new Date()
    switch (source) {
      case 'day':
        return withoutNestedSubtasks(dayWithoutTime(range.tasks, selectedDay, now, (task) => heldTasks.has(task.id)))
      case 'next7':
        return upcoming.data.filter((task) => inNextSevenDays(task.due_date, today))
      case 'nodate':
        return anytime.data.filter((task) => isNoDueDate(task.due_date) && task.project_id !== inboxId)
      default:
        return project.data
    }
  }, [source, range.tasks, selectedDay, heldTasks, upcoming.data, anytime.data, project.data, today, dayKey, inboxId])
  const listed = useMemo(() => sourceTasks.filter((task) => matchesTitleFilter(task.title, filter)), [sourceTasks, filter])

  const dayPhrase = (day: LocalDate) => {
    const date = startOfLocalDay(day)
    const phrase = formatDateDisplay('header.day', date, new Date(), true, fmt)
    return day === today || day === addLocalDays(today, 1) ? phrase : date.toLocaleDateString(fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' })
  }
  const dayLabel = dayListLabel(dayPhrase(selectedDay))
  const sourceLabel = useMemo(() => {
    const list = sourceLists(dayLabel).find((item) => item.source === source)
    if (list) return list.label
    const id = sourceProjectId(source, inboxId)
    return projects?.flat.find((candidate) => candidate.id === id)?.title ?? 'Project'
  }, [source, dayLabel, projects, inboxId])

  const routines = usePlanRoutines(days)

  // Plan my day takes the place of the list and the views while it runs.
  const [inSession, setInSession] = useState(false)

  // A block's popover, by task id so it always shows the task as it is now.
  const [pressed, setPressed] = useState<{ id: number; element: HTMLElement } | null>(null)
  const pressedTask = pressed ? range.tasks.find((task) => task.id === pressed.id) : undefined

  // A drawn stretch, waiting for its title.
  const [drawn, setDrawn] = useState<{ day: LocalDate; range: GestureRange } | null>(null)
  const drawnRef = useRef<HTMLDivElement | null>(null)
  const drawProject = drawTargetProject(source, inboxId, canWriteProject)
  const addDrawn = (title: string) => {
    if (!drawn) return
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

  // Totals of the selected day.
  const now = new Date()
  const planned = plannedMinutes(range.tasks, selectedDay)
  const free = freeMinutes(now, selectedDay, prefs.hours, busyOfDay(range.tasks, selectedDay))

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
      busy: busyOfDay(range.tasks, selectedDay),
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
          <button type="button" aria-label="Back" data-plan-prev onClick={() => go(-1)} className="flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" data-plan-today onClick={goToday} className="rounded-control px-2 py-1 text-meta font-medium text-text hover:bg-bg-hover">
            Today
          </button>
          <button type="button" aria-label="Forward" data-plan-next onClick={() => go(1)} className="flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-bg-hover">
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
              <PlannerOptions />
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
            <SourceMenu
              source={source}
              dayLabel={dayLabel}
              label={sourceLabel}
              count={sourceTasks.length}
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
          onClose={() => setPressed(null)}
        />
      )}

      {drawn && (
        <DrawTitle
          anchorRef={drawnRef}
          start={atClock(drawn.day, drawn.range.startMinute)}
          end={atClock(drawn.day, drawn.range.endMinute)}
          projectName={projects?.flat.find((candidate) => candidate.id === drawProject)?.title}
          onSubmit={addDrawn}
          onCancel={() => setDrawn(null)}
        />
      )}
    </div>
  )
}
