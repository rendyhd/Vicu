import { useSearch } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useSearchTasks } from '@/hooks/use-search-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useMemo } from 'react'
import { TaskList } from '@/components/task-list/TaskList'
import { EmptyState } from '@/components/shared/EmptyState'

export function SearchView() {
  const { q } = useSearch({ from: '/search' })

  const { data: tasks = [], isLoading } = useSearchTasks(q)
  const { data: projects } = useProjects()
  const visibleTasks = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return tasks.filter((task) => activeIds.has(task.project_id))
  }, [tasks, projects?.flat])

  if (!q) {
    return <EmptyState icon={Search} title="Enter a search query" subtitle="Use the search bar to find tasks" />
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Searching...
      </div>
    )
  }

  return (
    <TaskList
      title={`Search: "${q}"`}
      tasks={visibleTasks}
      showNewTask={false}
      emptyTitle="No tasks found"
      emptySubtitle={`No results for "${q}"`}
    />
  )
}
