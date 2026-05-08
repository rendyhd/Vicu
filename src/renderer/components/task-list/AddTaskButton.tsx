import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface AddTaskButtonProps {
  onClick: () => void
  label?: string
  className?: string
}

export function AddTaskButton({ onClick, label = 'Add Task', className }: AddTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'mx-4 my-2 flex items-center justify-center gap-1.5 rounded-full border border-dashed border-[var(--border-color)] px-4 py-2 text-[12px] leading-none text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]',
        className
      )}
      aria-label={label}
    >
      <Plus className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  )
}
