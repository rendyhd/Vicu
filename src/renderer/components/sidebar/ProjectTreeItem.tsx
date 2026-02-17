import { useNavigate, useMatches } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { useDndContext } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import type { ProjectTreeNode } from '@/hooks/use-projects'

interface ProjectTreeItemProps {
  node: ProjectTreeNode
  depth?: number
  siblings: ProjectTreeNode[]
  onContextMenu?: (e: React.MouseEvent, node: ProjectTreeNode) => void
}

export function ProjectTreeItem({ node, depth = 0, siblings, onContextMenu }: ProjectTreeItemProps) {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const { active } = useDndContext()

  const isActive = currentPath === `/project/${node.id}`

  const activeType = (active?.data.current as Record<string, unknown>)?.type as string | undefined

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `project-${node.id}`,
    data: { type: 'project', projectId: node.id, node, siblings },
  })

  // When a task is dragged over, show blue ring (drop target).
  // When a project is being dragged, show sortable displacement.
  const isTaskDragOver = isOver && activeType === 'task'

  // Only allow vertical displacement — zero out X to prevent horizontal jump
  const yOnlyTransform = transform ? { ...transform, x: 0 } : transform
  // Only apply transition while a drag is active — prevents bounce when transforms reset after drop
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(yOnlyTransform),
    transition: active ? (transition ?? undefined) : undefined,
    opacity: isDragging ? 0.4 : undefined,
    paddingLeft: `${depth * 16 + 8}px`,
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex h-7 cursor-default items-center rounded-md transition-colors',
        isTaskDragOver
          ? 'bg-[var(--accent-blue)]/15 ring-1 ring-[var(--accent-blue)]'
          : isActive
            ? 'bg-[var(--bg-selected)] text-[var(--text-primary)]'
            : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
      )}
      style={style}
      onClick={() => navigate({ to: '/project/$projectId', params: { projectId: String(node.id) } })}
      onContextMenu={(e) => onContextMenu?.(e, node)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate({ to: '/project/$projectId', params: { projectId: String(node.id) } })
      }}
    >
      <FolderOpen
        className="mr-2 h-3.5 w-3.5 shrink-0"
        style={{ color: node.hex_color || 'var(--text-secondary)' }}
        strokeWidth={1.8}
      />

      <span className="min-w-0 flex-1 truncate text-xs">{node.title}</span>
    </div>
  )
}
