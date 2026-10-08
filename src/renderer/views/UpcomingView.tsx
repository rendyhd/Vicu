import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { isUpcoming, localDateOf } from '@/lib/due-dates'
import { TaskList } from '@/components/task-list/TaskList'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { ProjectTaskGroup } from '@/components/task-list/ProjectTaskGroup'
import { openCount } from '@/lib/list-sections'
import { DueDateContextProvider } from '@/components/task-list/TaskDueBadge'
import { useDateFormat } from '@/hooks/use-date-format'
import { formatDateDisplay, type DateFormat } from '@/lib/date-display'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'

function formatDateHeader(dateStr: string, fmt: DateFormat): string {
  return formatDateDisplay('header.day', new Date(dateStr), new Date(), true, fmt)
}

function getDateKey(date: string): string {
  return localDateOf(date)
}

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

interface DateGroup {
  key: string
  label: string
  tasks: Task[]
}

export function UpcomingView() {
  const params = useFilters({ view: 'upcoming' })
  // Recomputes the groups when the local day rolls over (Today / Tomorrow / weekday headings).
  const dayKey = useDayKey()
  const dateFormat = useDateFormat()
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projects } = useProjects()
  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) {
        setInboxProjectId(config.inbox_project_id)
      }
    })
  }, [])

  const groups = useMemo(() => {
    const grouped = new Map<string, DateGroup>()
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    const now = new Date()
    for (const task of tasks) {
      if (!activeIds.has(task.project_id)) continue
      // Client-side filter: local due date tomorrow or later (no due date, today and overdue are out)
      if (!isUpcoming(task.due_date, now)) continue
      const key = getDateKey(task.due_date)
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: formatDateHeader(task.due_date, dateFormat),
          tasks: [],
        })
      }
      grouped.get(key)!.tasks.push(task)
    }
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key))
  }, [tasks, projects?.flat, dayKey, dateFormat])

  usePrintable(
    useMemo(
      () => ({
        viewTitle: 'Upcoming',
        sections: groups.map((g) => ({
          heading: g.label,
          groups: groupByProject(g.tasks, projects?.flat).map((pg) => ({
            heading: pg.name,
            tasks: pg.tasks,
          })),
        })),
      }),
      [groups, projects?.flat]
    )
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <DueDateContextProvider value="row.inDayGroup">
      <TaskList
        title="Upcoming"
        identity="upcoming"
        tasks={[]}
        projectId={inboxProjectId}
        showNewTask={!!inboxProjectId && projects?.flat.some((project) => project.id === inboxProjectId)}
        emptyTitle="Nothing upcoming"
        emptySubtitle="Tasks with future due dates appear here"
      >
        {groups.map((group) => {
          const projectGroups = groupByProject(group.tasks, projects?.flat)
          return (
            <div key={group.key}>
              <ListSectionHeader level={1} title={group.label} count={openCount(group.tasks)} />
              {projectGroups.map((pg) => (
                <ProjectTaskGroup key={pg.name} level={2} name={pg.name} color={pg.color} tasks={pg.tasks} />
              ))}
            </div>
          )
        })}
      </TaskList>
    </DueDateContextProvider>
  )
}
