import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { isOverdue, isToday } from '@/lib/date-utils'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import { api } from '@/lib/api'
import type { Task } from '@/lib/vikunja-types'

function groupByProject(tasks: Task[], projectsFlat?: { id: number; title: string }[]) {
  const byProject = new Map<number, { name: string; tasks: Task[] }>()
  for (const task of tasks) {
    const pid = task.project_id
    if (!byProject.has(pid)) {
      byProject.set(pid, {
        name: projectsFlat?.find((p) => p.id === pid)?.title ?? 'Unknown Project',
        tasks: [],
      })
    }
    byProject.get(pid)!.tasks.push(task)
  }
  return Array.from(byProject.values()).sort((a, b) => a.name.localeCompare(b.name))
}

const TODAY = new Date()

export function TodayView() {
  const params = useFilters({ view: 'today' })
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

  const { overdueTasks, todayTasks } = useMemo(() => {
    const overdue: typeof tasks = []
    const today: typeof tasks = []
    for (const t of tasks) {
      if (isOverdue(t.due_date)) {
        overdue.push(t)
      } else if (isToday(t.due_date)) {
        today.push(t)
      }
    }
    return { overdueTasks: overdue, todayTasks: today }
  }, [tasks])

  const overdueGroups = useMemo(
    () => groupByProject(overdueTasks, projects?.flat),
    [overdueTasks, projects?.flat]
  )
  const todayGroups = useMemo(
    () => groupByProject(todayTasks, projects?.flat),
    [todayTasks, projects?.flat]
  )

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title="Today"
      tasks={[]}
      projectId={inboxProjectId}
      showNewTask={!!inboxProjectId}
      defaultDueDate={TODAY}
      headerContent={<p className="px-6 pb-3 text-xs text-[var(--text-secondary)]">{dateStr}</p>}
      emptyTitle="All clear for today"
      emptySubtitle="Tasks due today will appear here"
    >
      {overdueTasks.length > 0 && (
        <div>
          <div className="px-6 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-red">
              Overdue
            </span>
          </div>
          {overdueGroups.map((group) => (
            <div key={group.name}>
              <div className="px-6 pb-0.5 pt-1.5">
                <span className="text-[10px] font-medium tracking-wide text-[var(--text-secondary)]">
                  {group.name}
                </span>
              </div>
              {group.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          ))}
        </div>
      )}

      {todayTasks.length > 0 && (
        <div>
          {overdueTasks.length > 0 && (
            <div className="px-6 pb-1 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Today
              </span>
            </div>
          )}
          {todayGroups.map((group) => (
            <div key={group.name}>
              <div className="px-6 pb-0.5 pt-1.5">
                <span className="text-[10px] font-medium tracking-wide text-[var(--text-secondary)]">
                  {group.name}
                </span>
              </div>
              {group.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          ))}
        </div>
      )}
    </TaskList>
  )
}
