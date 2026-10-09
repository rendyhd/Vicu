import { cn } from '@/lib/cn'
import { useCompleteTask, useUncompleteTask } from '@/hooks/use-task-mutations'
import { useCompletionPlay } from '@/hooks/use-completion-play'
import type { Task } from '@/lib/vikunja-types'
import { confirmTaskCompletion } from '@/lib/task-completion'
import { focusNextCheckbox } from '@/lib/next-row'
import { useSelectionStore } from '@/stores/selection-store'

interface TaskCheckboxProps {
  task: Task
  className?: string
  suppressTopLevelUndo?: boolean
}

const CHECK_PATH = 'M2.5 6L5 8.5L9.5 3.5'

export function TaskCheckbox({ task, className, suppressTopLevelUndo = false }: TaskCheckboxProps) {
  const completeTask = useCompleteTask()
  const uncompleteTask = useUncompleteTask()
  // The fill pops and the check draws only when the task is completed while this checkbox is on screen.
  const play = useCompletionPlay(task.done)

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={task.done}
      onClick={async (e) => {
        e.stopPropagation()
        // Space and Enter on the focused checkbox click it with detail 0; a pointer click has at least 1.
        const byKeyboard = e.detail === 0
        if (task.done) {
          uncompleteTask.mutate(task)
        } else if (await confirmTaskCompletion(task)) {
          completeTask.mutate(suppressTopLevelUndo ? { task, suppressTopLevelUndo: true } : task)
          if (byKeyboard) {
            // Completing from the keyboard keeps the keyboard moving: on to the next open row, and its
            // hold starts as focus leaves this one.
            const next = focusNextCheckbox(task.id)
            if (next !== null) useSelectionStore.getState().setFocusedTask(next)
          }
        }
      }}
      className={cn(
        // 20 px circle in a 24 px hit area: the pseudo-element grows the 18 px padding box (20 minus the
        // 1 px border) by 3 px on each side, and the pointer treats it as part of the button.
        'group/check relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-fade-base after:absolute after:-inset-[3px] after:content-[""]',
        task.done ? 'border-accent-fill' : 'border-control-ring hover:border-accent-fill hover:bg-accent-fill/10',
        className
      )}
      aria-label={`Complete ${task.title}`}
    >
      {task.done && (
        // The ring fill: it scales in with the pop spring when the task was just completed.
        <span
          aria-hidden="true"
          className={cn(
            '-inset-px absolute rounded-full bg-accent-fill transition-opacity duration-fade-base group-hover/check:opacity-80',
            play && 'vicu-check-fill-play'
          )}
        />
      )}
      {task.done ? (
        <svg className="relative h-3 w-3 text-on-accent" viewBox="0 0 12 12" fill="none">
          <path
            d={CHECK_PATH}
            pathLength={1}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(play && 'vicu-check-draw vicu-check-draw-play')}
          />
        </svg>
      ) : (
        <svg className="h-3 w-3 text-accent-fill opacity-0 transition-opacity group-hover/check:opacity-100" viewBox="0 0 12 12" fill="none">
          <path d={CHECK_PATH} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
