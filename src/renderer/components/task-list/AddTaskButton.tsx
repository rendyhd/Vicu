import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface AddTaskButtonProps {
  onClick: () => void
  label?: string
  className?: string
}

/**
 * The quiet "New task" row at the end of a list. It lines up with the task rows (the plus sits where
 * their checkbox does) and turns into the composer in place when it is used.
 */
export function AddTaskButton({ onClick, label = 'New task', className }: AddTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2.5 text-left text-task-title text-text-secondary transition-colors duration-fade-fast hover:bg-bg-hover hover:text-text',
        className
      )}
      aria-label={label}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Plus className="h-4 w-4" />
      </span>
      <span>{label}</span>
    </button>
  )
}
