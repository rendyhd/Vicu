import { cn } from '@/lib/cn'
import { useCompleteTask, useUncompleteTask } from '@/hooks/use-task-mutations'
import type { Task } from '@/lib/vikunja-types'

interface TaskCheckboxProps {
  task: Task
  className?: string
}

export function TaskCheckbox({ task, className }: TaskCheckboxProps) {
  const completeTask = useCompleteTask()
  const uncompleteTask = useUncompleteTask()

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (task.done) {
          uncompleteTask.mutate(task)
        } else {
          completeTask.mutate(task)
        }
      }}
      className={cn(
        'group/check flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-all duration-200',
        task.done
          ? 'border-[var(--text-secondary)] bg-[var(--text-secondary)] hover:border-[var(--accent-blue)] hover:bg-[var(--accent-blue)]'
          : 'border-[var(--border-color)] hover:border-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10',
        className
      )}
      aria-label={task.done ? 'Mark as incomplete' : 'Mark as done'}
    >
      {task.done ? (
        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-2.5 w-2.5 text-[var(--accent-blue)] opacity-0 transition-opacity group-hover/check:opacity-100" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
