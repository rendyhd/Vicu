import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { splitTodayOverdue } from '@/lib/today-overdue'
import { TaskList } from '@/components/task-list/TaskList'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ProjectTaskGroup } from '@/components/task-list/ProjectTaskGroup'
import { openCount } from '@/lib/list-sections'
import { DueDateContextProvider } from '@/components/task-list/TaskDueBadge'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateDisplay } from '@/lib/date-display'
import { api } from '@/lib/api'
import { showRoutinesInToday, type Task } from '@/lib/vikunja-types'
import { useAppConfig } from '@/hooks/use-app-config'
import { RoutineTodaySection } from '@/components/routines/RoutineTodaySection'

function groupByProject(tasks: Task[], projectsFlat?: { id: number; title: string; hex_color?: string }[]) {
  const activeIds = new Set(projectsFlat?.map((project) => project.id) ?? [])
  const byProject = new Map<number, { name: string; color?: string; tasks: Task[] }>()
  for (const task of tasks) {
    const pid = task.project_id
    if (!activeIds.has(pid)) continue
    if (!byProject.has(pid)) {
      byProject.set(pid, {
        name: projectsFlat?.find((p) => p.id === pid)?.title ?? 'Unknown Project',
        color: projectsFlat?.find((p) => p.id === pid)?.hex_color,
        tasks: [],
      })
    }
    byProject.get(pid)!.tasks.push(task)
  }
  return Array.from(byProject.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function TodayView() {
  const params = useFilters({ view: 'today' })
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  // Wait for the config, so a turned-off section does not flash in (and fetch routines) on start.
  const routinesShown = !!config && showRoutinesInToday(config)
  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()
  // The local day: re-read when it rolls over at midnight (or after sleep), so a task added to Today
  // after midnight is dated today, not yesterday, and the overdue / due-today split follows.
  const dayKey = useDayKey()
  const today = useMemo(() => new Date(), [dayKey])

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) {
        setInboxProjectId(config.inbox_project_id)
      }
    })
  }, [])

  const { overdueTasks, todayTasks } = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    // Local calendar date: overdue is before today, Today is today whatever the time of day. The
    // same split feeds the app icon badge, so the two cannot disagree.
    const { overdue, today } = splitTodayOverdue(tasks, activeIds, new Date())
    return { overdueTasks: overdue, todayTasks: today }
  }, [tasks, projects?.flat, dayKey])

  const overdueGroups = useMemo(
    () => groupByProject(overdueTasks, projects?.flat),
    [overdueTasks, projects?.flat]
  )
  const todayGroups = useMemo(
    () => groupByProject(todayTasks, projects?.flat),
    [todayTasks, projects?.flat]
  )

  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Today',
        sections: [
          ...(overdueGroups.length > 0
            ? [{ heading: 'Overdue', groups: overdueGroups.map((g) => ({ heading: g.name, tasks: g.tasks })) }]
            : []),
          ...(todayGroups.length > 0
            ? [{ heading: overdueGroups.length > 0 ? 'Today' : undefined, groups: todayGroups.map((g) => ({ heading: g.name, tasks: g.tasks })) }]
            : []),
        ],
      }),
      [overdueGroups, todayGroups]
    )
  )

  const dateFormat = useDateFormat()
  const now = new Date()
  const dateStr = formatDateDisplay('header.full', now, now, true, dateFormat)

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <DueDateContextProvider value="row.inToday">
      <TaskList
        title="Today"
        identity="today"
        tasks={[]}
        projectId={inboxProjectId}
        showNewTask={!!inboxProjectId && projects?.flat.some((project) => project.id === inboxProjectId)}
        defaultDueDate={today}
        headerContent={<p className="px-6 pb-3 text-xs text-[var(--text-secondary)]">{dateStr}</p>}
        emptyTitle="All clear for today"
        emptySubtitle="Tasks due today will appear here"
      >
        {routinesShown && <RoutineTodaySection hideFinished />}
        {overdueTasks.length > 0 && (
          <div>
            <ListSectionHeader level={1} title="Overdue" count={openCount(overdueTasks)} tone="overdue" />
            {overdueGroups.map((group) => (
              <ProjectTaskGroup key={group.name} level={2} name={group.name} color={group.color} tasks={group.tasks} />
            ))}
          </div>
        )}

        {todayTasks.length > 0 && (
          <div>
            {overdueTasks.length > 0 && (
              <ListSectionHeader level={1} title="Today" count={openCount(todayTasks)} />
            )}
            {/* Without an Overdue section above, the projects are the top level of the list. */}
            {todayGroups.map((group) => (
              <ProjectTaskGroup
                key={group.name}
                level={overdueTasks.length > 0 ? 2 : 1}
                name={group.name}
                color={group.color}
                tasks={group.tasks}
              />
            ))}
          </div>
        )}
      </TaskList>
    </DueDateContextProvider>
  )
}
