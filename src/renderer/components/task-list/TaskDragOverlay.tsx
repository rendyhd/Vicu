import { useDndContext } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { CornerDownRight } from 'lucide-react'
import type { Task } from '@/lib/vikunja-types'

interface TaskDragOverlayProps {
  task: Task
  /** Number of tasks being dragged. >1 renders a stacked look with a count badge. */
  count?: number
}

export function TaskDragOverlay({ task, count = 1 }: TaskDragOverlayProps) {
  const { t } = useTranslation()
  const multi = count > 1
  // Over the middle of another row (cross-app semantics 24.6): the chip says whose subtask it becomes.
  const { over } = useDndContext()
  const overData = over?.data.current as { type?: string; task?: Task } | undefined
  const nestInto = overData?.type === 'task-nest' ? overData.task : undefined
  return (
    <div className="relative w-fit max-w-[min(100%,20rem)]">
      {multi && (
        <>
          <div className="absolute inset-x-2 -bottom-1.5 h-10 rounded-card border-2 border-accent-blue/30 bg-[var(--bg-primary)]" />
          <div className="absolute inset-x-1 -bottom-[3px] h-10 rounded-card border-2 border-accent-blue/50 bg-[var(--bg-primary)]" />
        </>
      )}
      <div className="vicu-lift relative flex h-10 items-center gap-3 rounded-card border-2 border-[var(--accent-blue)] bg-[var(--bg-primary)] px-4 shadow-xl">
        <div className="h-5 w-5 shrink-0 rounded-full border border-control-ring" />
        <span className="truncate text-task-title text-text">{task.title}</span>
        {multi && (
          <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent-fill px-1.5 text-chip text-on-accent">
            {count}
          </span>
        )}
      </div>
      {nestInto && (
        <div data-drop-hint="nest" className="vicu-lift relative mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-chip border border-[var(--accent-blue)] bg-[var(--bg-primary)] px-2 py-0.5 text-caption text-text shadow-md">
          <CornerDownRight className="h-3 w-3 shrink-0 text-accent-blue" aria-hidden="true" />
          <span className="truncate">{t('task.attach.dropOnto', { title: nestInto.title })}</span>
        </div>
      )}
    </div>
  )
}
