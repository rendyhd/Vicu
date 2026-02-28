import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { isNullDate, isToday, isOverdue } from '@/lib/date-utils'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import type { Task } from '@/lib/vikunja-types'

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays > 1 && diffDays <= 6) {
    return d.toLocaleDateString('en-US', { weekday: 'long' })
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function getDateKey(date: string): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

interface DateGroup {
  key: string
  label: string
  tasks: Task[]
}

export function UpcomingView() {
  const params = useFilters({ view: 'upcoming' })
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projects } = useProjects()


  const groups = useMemo(() => {
    const grouped = new Map<string, DateGroup>()
    for (const task of tasks) {
      if (isNullDate(task.due_date)) continue
      // Client-side filter: exclude today and overdue tasks
      if (isToday(task.due_date) || isOverdue(task.due_date)) continue
      const key = getDateKey(task.due_date)
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          label: formatDateHeader(task.due_date),
          tasks: [],
        })
      }
      grouped.get(key)!.tasks.push(task)
    }
    return Array.from(grouped.values()).sort((a, b) => a.key.localeCompare(b.key))
  }, [tasks])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title="Upcoming"
      tasks={[]}
      showNewTask={false}
      emptyTitle="Nothing upcoming"
      emptySubtitle="Tasks with future due dates appear here"
    >
      {groups.map((group) => {
        const projectGroups = groupByProject(group.tasks, projects?.flat)
        return (
          <div key={group.key}>
            <div className="px-6 pb-1 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {group.label}
              </span>
            </div>
            {projectGroups.map((pg) => (
              <div key={pg.name}>
                <div className="px-6 pb-0.5 pt-1.5">
                  <span className="text-[10px] font-medium tracking-wide text-[var(--text-secondary)]">
                    {pg.name}
                  </span>
                </div>
                {pg.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            ))}
          </div>
        )
      })}
    </TaskList>
  )
}
