import { useDroppable } from '@dnd-kit/core'
import { useDndContext } from '@dnd-kit/core'
import { cn } from '@/lib/cn'

interface ParentDropZoneProps {
  projectId: number
}

export function ParentDropZone({ projectId }: ParentDropZoneProps) {
  const { active } = useDndContext()
  const { isOver, setNodeRef } = useDroppable({
    id: `parent-project-${projectId}`,
    data: { type: 'parent-project', projectId },
  })

  const activeType = (active?.data.current as Record<string, unknown>)?.type as string | undefined
  const isDraggingTask = active && activeType === 'task'

  // Only show when a task is being dragged
  if (!isDraggingTask) return <div ref={setNodeRef} />

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mx-4 mb-1 rounded-md border-2 border-dashed py-1.5 text-center text-[11px] transition-colors',
        isOver
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--text-primary)]'
          : 'border-[var(--border-color)] text-[var(--text-secondary)]'
      )}
    >
      Move to unsectioned
    </div>
  )
}
