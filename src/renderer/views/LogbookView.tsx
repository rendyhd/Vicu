import { useEffect, useMemo, useRef } from 'react'
import { useLogbookTasks } from '@/hooks/use-logbook-tasks'
import { useProjects } from '@/hooks/use-projects'
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { groupLogbookTasks } from '@/lib/logbook'
import { useDateFormat } from '@/hooks/use-date-format'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { TaskCheckbox } from '@/components/task-list/TaskCheckbox'
import { Inbox } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { ReadingScroll } from '@/components/layout/ReadingScroll'
import { SmartListIcon } from '@/components/shared/SmartListIcon'
import type { Task } from '@/lib/vikunja-types'

/**
 * A completed task: a filled check, the title in the muted colour (no strikethrough, the check says
 * it is done) and the time of the completion on the right. The day is the group heading above.
 * A task reopened here stays in the list as an ordinary open row until the user navigates away.
 */
function LogbookRow({ task, time }: { task: Task; time: string }) {
  return (
    <div className="flex h-10 items-center gap-3 border-b border-[var(--border-color)] px-4">
      <TaskCheckbox task={task} />
      <span className={`min-w-0 flex-1 truncate text-task-title ${task.done ? 'text-text-secondary' : 'text-text'}`}>
        {task.title}
      </span>
      {time && <span className="shrink-0 text-meta tabular-nums text-text-secondary">{time}</span>}
    </div>
  )
}

export function LogbookView() {
  const { tasks, isLoading, hasMore, isLoadingMore, moreError, loadMore, retryMore } = useLogbookTasks()
  const { data: projects } = useProjects()
  const dateFormat = useDateFormat()
  // Re-rendered when the local day rolls over, so "Today" becomes "Yesterday" at midnight.
  const dayKey = useDayKey()
  const visibleTasks = useMemo(() => {
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return tasks.filter((task) => activeIds.has(task.project_id))
  }, [tasks, projects?.flat])

  // Newest first, grouped by the day of the completion; the clock is read again at each render, and
  // useDayKey renders again at midnight.
  const groups = useMemo(
    () => groupLogbookTasks(visibleTasks, new Date(), dateFormat),
    // dayKey stands for the clock: a new local day regroups the rows.
    [visibleTasks, dateFormat, dayKey]
  )

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
      <PageHeader title="Logbook" icon={<SmartListIcon list="logbook" className="h-5 w-5" />} />

      <ReadingScroll ref={scrollRef}>
        {visibleTasks.length === 0 && !hasMore && !isLoadingMore && !moreError ? (
          <EmptyState icon={Inbox} identity="logbook" title="No completed tasks" subtitle="Completed tasks appear here" />
        ) : (
          groups.map((group, index) => (
            <section key={`${index}:${group.title}`} aria-label={group.title || undefined}>
              {group.title !== '' && <ListSectionHeader level={1} title={group.title} />}
              {group.rows.map(({ task, time }) => (
                <LogbookRow key={task.id} task={task} time={time} />
              ))}
            </section>
          ))
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
      </ReadingScroll>
    </div>
  )
}
