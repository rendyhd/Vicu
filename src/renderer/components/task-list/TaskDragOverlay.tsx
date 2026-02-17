import type { Task } from '@/lib/vikunja-types'

interface TaskDragOverlayProps {
  task: Task
}

export function TaskDragOverlay({ task }: TaskDragOverlayProps) {
  return (
    <div className="flex h-10 items-center gap-3 rounded-lg border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-4 shadow-lg">
      <div className="h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
      <span className="truncate text-[13px] text-[var(--text-primary)]">{task.title}</span>
    </div>
  )
}
