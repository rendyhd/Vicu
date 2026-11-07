import { useSearch } from '@tanstack/react-router'
import { useSearchTasks } from '@/hooks/use-search-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useMemo, useState } from 'react'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { SearchFilterBar } from '@/components/search/SearchFilterBar'
import { searchFiltersActive, type SearchFilters } from '../../shared/search-filters'

// Results come from every project and have no group headers, so each row names its project.
const ROW_VIEW = { showProject: true }

export function SearchView() {
  const { q } = useSearch({ from: '/search' })

  // They last while this page is open (contract section 17).
  const [filters, setFilters] = useState<SearchFilters>({})
  const filtered = searchFiltersActive(filters)
  const { data: tasks = [], isLoading } = useSearchTasks(q, filters)
  const { data: projects } = useProjects()
  const visibleTasks = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return tasks.filter((task) => activeIds.has(task.project_id))
  }, [tasks, projects?.flat])

  // One tree whatever the state: the chips stay under the title, and an open filter stays open while
  // its results load.
  const asked = !!q || filtered
  return (
    <RowViewProvider value={ROW_VIEW}>
      <TaskList
        title={q ? `Search: "${q}"` : 'Search'}
        tasks={asked ? visibleTasks : []}
        showNewTask={false}
        headerContent={<div className="px-4 pb-2"><SearchFilterBar filters={filters} onChange={setFilters} /></div>}
        emptyTitle={!asked ? 'Enter a search query' : isLoading ? 'Searching...' : 'No tasks found'}
        emptySubtitle={!asked ? 'Use the search bar to find tasks, or a filter above' : isLoading ? undefined : filtered ? 'Try fewer filters' : `No results for "${q}"`}
      />
    </RowViewProvider>
  )
}
