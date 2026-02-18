import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { useProjects } from '@/hooks/use-projects'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'
import type { Task } from '@/lib/vikunja-types'

export function AnytimeView() {
  const params = useFilters({ view: 'anytime' })
  const { data: tasks = [], isLoading } = useTasks(params)
  const { data: projectData } = useProjects()

  const groups = useMemo(() => {
    const projectMap = new Map(projectData?.flat.map((p) => [p.id, p]))

    // Group tasks by their root (top-level) project
    const getRootId = (id: number): number => {
      const p = projectMap.get(id)
      if (!p || !p.parent_project_id) return id
      return getRootId(p.parent_project_id)
    }

    interface SubGroup {
      projectId: number
      projectName: string
      tasks: Task[]
    }
    interface RootGroup {
      projectId: number
      projectName: string
      subGroups: SubGroup[]
    }

    // Group tasks by root project, then by direct project
    const byRoot = new Map<number, Map<number, Task[]>>()
    for (const task of tasks) {
      const rootId = getRootId(task.project_id)
      if (!byRoot.has(rootId)) byRoot.set(rootId, new Map())
      const sub = byRoot.get(rootId)!
      const pid = task.project_id
      if (!sub.has(pid)) sub.set(pid, [])
      sub.get(pid)!.push(task)
    }

    return Array.from(byRoot.entries()).map(([rootId, subMap]): RootGroup => ({
      projectId: rootId,
      projectName: projectMap.get(rootId)?.title ?? `Project ${rootId}`,
      subGroups: Array.from(subMap.entries()).map(([pid, tasks]) => ({
        projectId: pid,
        projectName: projectMap.get(pid)?.title ?? `Project ${pid}`,
        tasks,
      })),
    }))
  }, [tasks, projectData])

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
          {group.subGroups.map((sub) =>
            sub.projectId === group.projectId ? (
              sub.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))
            ) : (
              <div key={sub.projectId}>
                <div className="pb-1 pt-2 pl-10">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                    {sub.projectName}
                  </span>
                </div>
                <div className="pl-4">
                  {sub.tasks.map((task) => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      ))}
    </TaskList>
  )
}
