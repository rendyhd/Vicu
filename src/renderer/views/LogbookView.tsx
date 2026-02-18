import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
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
      <span className="shrink-0 text-2xs text-[var(--text-secondary)]">
        {formatCompletionDate(task.done_at)}
      </span>
    </div>
  )
}

export function LogbookView() {
  const params = useFilters({ view: 'logbook' })
  const { data: tasks = [], isLoading } = useTasks(params)

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

      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <EmptyState icon={Inbox} title="No completed tasks" subtitle="Completed tasks appear here" />
        ) : (
          tasks.map((task) => <LogbookRow key={task.id} task={task} />)
        )}
      </div>
    </div>
  )
}
