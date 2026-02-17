import { useEffect, useMemo, useState } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { useProjects } from '@/hooks/use-projects'
import { api } from '@/lib/api'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import type { Task } from '@/lib/vikunja-types'

export function AnytimeView() {
  const [inboxProjectId, setInboxProjectId] = useState<number>(0)

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config) {
        setInboxProjectId(config.inbox_project_id ?? 0)
      }
    })
  }, [])

  const params = useFilters({ view: 'anytime' })
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projectData } = useProjects()

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (inboxProjectId && t.project_id === inboxProjectId) return false
      return true
    })
  }, [tasks, inboxProjectId])

  const groups = useMemo(() => {
    const byProject = new Map<number, Task[]>()
    for (const task of filteredTasks) {
      const pid = task.project_id
      if (!byProject.has(pid)) byProject.set(pid, [])
      byProject.get(pid)!.push(task)
    }
    return Array.from(byProject.entries()).map(([pid, tasks]) => ({
      projectId: pid,
      projectName: projectData?.flat.find((p) => p.id === pid)?.title ?? `Project ${pid}`,
      tasks,
    }))
  }, [filteredTasks, projectData])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title="Anytime"
      tasks={[]}
      showNewTask={false}
      emptyTitle="Nothing here"
      emptySubtitle="Open tasks from all projects"
    >
      {groups.map((group) => (
        <div key={group.projectId}>
          <div className="px-6 pb-1 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {group.projectName}
            </span>
          </div>
          {group.tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      ))}
    </TaskList>
  )
}
