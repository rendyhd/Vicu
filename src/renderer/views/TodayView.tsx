import { useMemo } from 'react'
import { useTasks } from '@/hooks/use-tasks'
import { useFilters } from '@/hooks/use-filters'
import { isOverdue, isToday } from '@/lib/date-utils'
import { TaskList } from '@/components/task-list/TaskList'
import { TaskRow } from '@/components/task-list/TaskRow'

export function TodayView() {
  const params = useFilters({ view: 'today' })
  const { data: tasks = [], isLoading } = useTasks(params)

  const { overdueTasks, todayTasks } = useMemo(() => {
    const overdue: typeof tasks = []
    const today: typeof tasks = []
    for (const t of tasks) {
      if (isOverdue(t.due_date)) {
        overdue.push(t)
      } else if (isToday(t.due_date)) {
        today.push(t)
      }
    }
    return { overdueTasks: overdue, todayTasks: today }
  }, [tasks])

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <TaskList
      title="Today"
      tasks={[]}
      showNewTask={false}
      emptyTitle="All clear for today"
      emptySubtitle="Tasks due today will appear here"
    >
      <p className="px-6 pb-3 text-xs text-[var(--text-secondary)]">{dateStr}</p>

      {overdueTasks.length > 0 && (
        <div>
          <div className="px-6 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-red">
              Overdue
            </span>
          </div>
          {overdueTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}

      {todayTasks.length > 0 && (
        <div>
          {overdueTasks.length > 0 && (
            <div className="px-6 pb-1 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Today
              </span>
            </div>
          )}
          {todayTasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </TaskList>
  )
}
