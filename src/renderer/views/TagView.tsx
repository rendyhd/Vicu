import { useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { useLabels } from '@/hooks/use-labels'
import { useFilters } from '@/hooks/use-filters'
import { TaskList } from '@/components/task-list/TaskList'

export function TagView() {
  const { labelId } = useParams({ from: '/tag/$labelId' })
  const lid = Number(labelId)
  const { data: labels } = useLabels()
  const labelName = labels?.find((l) => l.id === lid)?.title ?? 'Tag'

  const params = useFilters({ view: 'tag', labelId: lid })
  const { data: tasks = [], isLoading } = useTasks(params)

  const filtered = useMemo(() => {
    return tasks.filter((t) => t.labels?.some((l) => l.id === lid))
  }, [tasks, lid])

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
      tasks={filtered}
      showNewTask={false}
      emptyTitle={`No tasks tagged "${labelName}"`}
    />
  )
}
