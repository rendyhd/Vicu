import { useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { useLabels } from '@/hooks/use-labels'
import { useProjects } from '@/hooks/use-projects'
import { useFilters } from '@/hooks/use-filters'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'

export function TagView() {
  const { labelId } = useParams({ from: '/tag/$labelId' })
  const lid = Number(labelId)
  const { data: labels } = useLabels()
  const { data: projects } = useProjects()
  const labelName = labels?.find((l) => l.id === lid)?.title ?? 'Tag'

  const params = useFilters({ view: 'tag', labelId: lid })
  const { data: tasks = [], isLoading } = useTasks(params)

  const filtered = useMemo(() => {
    return tasks.filter((t) => t.labels?.some((l) => l.id === lid))
  }, [tasks, lid])

  const groups = useMemo(() => {
    const projectMap = new Map<number, { name: string; tasks: typeof filtered }>()
    for (const task of filtered) {
      const pid = task.project_id
      if (!projectMap.has(pid)) {
        const project = projects?.flat.find((p) => p.id === pid)
        projectMap.set(pid, {
          name: project?.title ?? 'Unknown Project',
          tasks: [],
        })
      }
      projectMap.get(pid)!.tasks.push(task)
    }
    return Array.from(projectMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [filtered, projects?.flat])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title={labelName}
      tasks={[]}
      showNewTask={false}
      emptyTitle={`No tasks tagged "${labelName}"`}
    >
      {groups.map((group) => (
        <div key={group.name}>
          <div className="px-6 pb-1 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {group.name}
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
