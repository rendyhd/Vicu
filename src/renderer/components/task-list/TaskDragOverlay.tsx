import type { Task } from '@/lib/vikunja-types'

interface TaskDragOverlayProps {
  task: Task
  /** Number of tasks being dragged. >1 renders a stacked look with a count badge. */
  count?: number
}

export function TaskDragOverlay({ task, count = 1 }: TaskDragOverlayProps) {
  const multi = count > 1
  return (
    <div className="relative">
      {multi && (
        <>
          <div className="absolute inset-x-2 -bottom-1.5 h-10 rounded-lg border-2 border-[var(--accent-blue)]/30 bg-[var(--bg-primary)]" />
          <div className="absolute inset-x-1 -bottom-[3px] h-10 rounded-lg border-2 border-[var(--accent-blue)]/50 bg-[var(--bg-primary)]" />
        </>
      )}
      <div className="relative flex h-10 items-center gap-3 rounded-lg border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-4 shadow-lg">
        <div className="h-[18px] w-[18px] shrink-0 rounded-full border border-[var(--border-color)]" />
        <span className="truncate text-[13px] text-[var(--text-primary)]">{task.title}</span>
        {multi && (
          <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] px-1.5 text-[11px] font-semibold text-white">
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
