import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useLogbookTasks } from '@/hooks/use-logbook-tasks'
import { useProjects } from '@/hooks/use-projects'
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { isNullDate } from '@/lib/date-utils'
import { formatDateDisplay, type DateFormat } from '@/lib/date-display'
import { useDateFormat } from '@/hooks/use-date-format'
import { cn } from '@/lib/cn'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { Task } from '@/lib/vikunja-types'

/** The group a completion belongs to ("Today", "Yesterday", "Mon 5 Oct", "September 2026"); '' without a time. */
function completionGroup(date: string, now: Date, fmt: DateFormat): string {
  if (isNullDate(date)) return ''
  return formatDateDisplay('logbook.group', new Date(date), now, false, fmt)
}

/** The time of the completion in the user's clock; the group heading above says the day. */
function completionTime(date: string, now: Date, fmt: DateFormat): string {
  if (isNullDate(date)) return ''
  return formatDateDisplay('logbook.time', new Date(date), now, false, fmt)
}

function LogbookRow({ task, time }: { task: Task; time: string }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-[var(--border-color)] px-4">
      <TaskCheckbox task={task} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-task-title',
          task.done
            ? 'text-[var(--text-secondary)] line-through'
            : 'text-[var(--text-primary)]'
        )}
      >
        {task.title}
      </span>
      <span className="shrink-0 text-meta text-[var(--text-secondary)]">
        {time}
      </span>
    </div>
  )
}

export function LogbookView() {
  const { tasks, isLoading, hasMore, isLoadingMore, moreError, loadMore, retryMore } = useLogbookTasks()
  const { data: projects } = useProjects()
  const dateFormat = useDateFormat()
  // Re-rendered when the local day rolls over, so "Today" becomes "Yesterday" at midnight.
  useDayKey()
  const now = new Date()
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
      <div className="flex items-center gap-2.5 px-6 pb-2 pt-6">
        <SmartListIcon list="logbook" className="h-5 w-5" />
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Logbook</h1>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {visibleTasks.length === 0 && !hasMore && !isLoadingMore && !moreError ? (
          <EmptyState icon={Inbox} title="No completed tasks" subtitle="Completed tasks appear here" />
        ) : (
          visibleTasks.map((task, index) => {
            // Newest first: a heading wherever the day group changes.
            const group = completionGroup(task.done_at, now, dateFormat)
            const previous = index > 0 ? completionGroup(visibleTasks[index - 1].done_at, now, dateFormat) : null
            return (
              <Fragment key={task.id}>
                {group !== '' && group !== previous && (
                  <ListSectionHeader level={1} title={group} />
                )}
                <LogbookRow task={task} time={completionTime(task.done_at, now, dateFormat)} />
              </Fragment>
            )
          })
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
