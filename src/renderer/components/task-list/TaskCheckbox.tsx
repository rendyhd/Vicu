import { cn } from '@/lib/cn'
import { useCompleteTask, useUncompleteTask } from '@/hooks/use-task-mutations'
import type { Task } from '@/lib/vikunja-types'
import { confirmTaskCompletion } from '@/lib/task-completion'

interface TaskCheckboxProps {
  task: Task
  className?: string
  suppressTopLevelUndo?: boolean
}

export function TaskCheckbox({ task, className, suppressTopLevelUndo = false }: TaskCheckboxProps) {
  const completeTask = useCompleteTask()
  const uncompleteTask = useUncompleteTask()

  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation()
        if (task.done) {
          uncompleteTask.mutate(task)
        } else if (await confirmTaskCompletion(task)) {
          completeTask.mutate(suppressTopLevelUndo ? { task, suppressTopLevelUndo: true } : task)
        }
      }}
      className={cn(
        // 20 px circle in a 24 px hit area: the pseudo-element grows the 18 px padding box (20 minus the
        // 1 px border) by 3 px on each side, and the pointer treats it as part of the button.
        'group/check relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-fade-base after:absolute after:-inset-[3px] after:content-[""]',
        task.done
          ? 'border-accent-fill bg-accent-fill hover:bg-accent-fill/80'
          : 'border-control-ring hover:border-accent-fill hover:bg-accent-fill/10',
        className
      )}
      aria-label={task.done ? 'Mark as incomplete' : 'Mark as done'}
    >
      {task.done ? (
        <svg className="h-3 w-3 text-on-accent" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-3 w-3 text-accent-fill opacity-0 transition-opacity group-hover/check:opacity-100" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
