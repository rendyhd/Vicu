import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { TaskRow } from '@/components/task-list/TaskRow'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { RowViewProvider, useRowView } from '@/components/task-list/RowViewContext'
import { useProjectCompleted, useShowDoneSetting } from '@/hooks/use-project-completed'
import type { Task } from '@/lib/vikunja-types'

interface ProjectCompletedRowProps {
  projectId: number
  /** The tasks the open list above shows (a task held there after its completion is not listed twice). */
  shownAbove: readonly Task[]
  /** The project screen shows the other mode's tasks too ("Show" under the list, 22.4). */
  showAll?: boolean
}

/**
 * The end of a project's list, the Inbox's included, while "Show completed tasks" is on (cross-app
 * semantics 12.6): a folded quiet row, "Completed" with the count, that opens on the project's own
 * done tasks, newest completion first, 20 at a time. Ticking a row reopens it, and it moves up into
 * the open list. Open or folded lasts while the view is open; give it `key={projectId}` so another
 * project starts folded.
 */
export function ProjectCompletedRow(props: ProjectCompletedRowProps) {
  const { on } = useShowDoneSetting()
  if (!on) return null
  return <CompletedSection {...props} />
}

function CompletedSection({ projectId, shownAbove, showAll = false }: ProjectCompletedRowProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const shownIds = useMemo(() => new Set(shownAbove.map((task) => task.id)), [shownAbove])
  const { count, tasks, isLoading, isLoadingMore, error, hasMore, loadMore, retry } = useProjectCompleted(projectId, open, shownIds, showAll)
  // The rows say the day of the completion in place of the due date; the rest of the view is kept.
  const outer = useRowView()
  const rowView = useMemo(() => ({ ...outer, doneDay: true }), [outer])

  return (
    <div className="mt-3 border-t border-border" data-project-completed>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-6 py-2.5 text-left text-meta text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-fade-fast', open && 'rotate-90')}
        />
        <span className="flex-1 font-medium">{t('views.project.completed.title')}</span>
        {count !== undefined && <span className="tabular-nums">{count}</span>}
      </button>

      {open && (
        <div id={listId}>
          {tasks.length > 0 && (
            <RowViewProvider value={rowView}>
              <TaskRowGroup>
                {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
              </TaskRowGroup>
            </RowViewProvider>
          )}
          {error && !isLoading ? (
            <div className="flex items-center gap-2 px-6 py-2 text-meta text-text-secondary">
              <span>{t('views.project.completed.failed')}</span>
              <button type="button" onClick={retry} className="rounded-control px-1.5 py-0.5 font-medium text-accent-blue hover:bg-bg-hover">
                {t('views.project.completed.retry')}
              </button>
            </div>
          ) : isLoading || isLoadingMore ? (
            <div className="px-6 py-2 text-meta text-text-secondary">{t('views.project.completed.loading')}</div>
          ) : hasMore ? (
            <div className="px-6 py-2">
              <button type="button" onClick={loadMore} className="rounded-control px-1.5 py-0.5 text-meta font-medium text-accent-blue hover:bg-bg-hover">
                {t('views.project.completed.showMore')}
              </button>
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-6 py-2 text-meta text-text-secondary">{t('views.project.completed.empty')}</div>
          ) : null}
        </div>
      )}
    </div>
  )
}
