import { useEffect, useMemo, useRef } from 'react'
import { useLogbookTasks } from '@/hooks/use-logbook-tasks'
import { useProjects } from '@/hooks/use-projects'
import { usePrintable } from '@/stores/print-store'
import { isNullDate } from '@/lib/date-utils'
import { cn } from '@/lib/cn'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import type { Task } from '@/lib/vikunja-types'

function formatCompletionDate(date: string): string {
  if (isNullDate(date)) return ''
  const d = new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function LogbookRow({ task }: { task: Task }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-[var(--border-color)] px-4">
      <TaskCheckbox task={task} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px]',
          task.done
            ? 'text-[var(--text-secondary)] line-through'
            : 'text-[var(--text-primary)]'
        )}
      >
        {task.title}
      </span>
      <span className="shrink-0 text-meta text-[var(--text-secondary)]">
        {formatCompletionDate(task.done_at)}
      </span>
    </div>
  )
}

export function LogbookView() {
  const { tasks, isLoading, hasMore, isLoadingMore, moreError, loadMore, retryMore } = useLogbookTasks()
  const { data: projects } = useProjects()
  const visibleTasks = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return tasks.filter((task) => activeIds.has(task.project_id))
  }, [tasks, projects?.flat])

  // The history loads a page at a time: the next page is asked for when the end of the list scrolls
  // into view (and by the button below, for anyone who cannot scroll).
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const end = endRef.current
    if (!end || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore() },
      { root: scrollRef.current, rootMargin: '200px' }
    )
    observer.observe(end)
    return () => observer.disconnect()
  }, [hasMore, loadMore, visibleTasks.length])

  usePrintable(
    useMemo(() => ({ viewTitle: 'Logbook', sections: [{ groups: [{ tasks: visibleTasks }] }] }), [visibleTasks])
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pb-2 pt-6">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Logbook</h1>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {visibleTasks.length === 0 && !hasMore && !isLoadingMore && !moreError ? (
          <EmptyState icon={Inbox} title="No completed tasks" subtitle="Completed tasks appear here" />
        ) : (
          visibleTasks.map((task) => <LogbookRow key={task.id} task={task} />)
        )}
        {moreError ? (
          <div className="flex items-center justify-center gap-2 px-6 py-3 text-xs text-[var(--text-secondary)]">
            <span>Could not load more completed tasks.</span>
            <button type="button" onClick={retryMore} className="text-[var(--accent-blue)] hover:underline">
              Try again
            </button>
          </div>
        ) : isLoadingMore ? (
          <div className="px-6 py-3 text-center text-xs text-[var(--text-secondary)]">Loading...</div>
        ) : hasMore ? (
          <div ref={endRef} className="flex justify-center px-6 py-3">
            <button
              type="button"
              onClick={loadMore}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
            >
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
