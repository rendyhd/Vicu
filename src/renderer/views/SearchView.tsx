import { useSearch } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useSearchTasks } from '@/hooks/use-search-tasks'
import { TaskList } from '@/components/task-list/TaskList'
import { EmptyState } from '@/components/shared/EmptyState'

export function SearchView() {
  const { q } = useSearch({ from: '/search' })

  const { data: tasks = [], isLoading } = useSearchTasks(q)

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
      tasks={tasks}
      showNewTask={false}
      emptyTitle="No tasks found"
      emptySubtitle={`No results for "${q}"`}
    />
  )
}
