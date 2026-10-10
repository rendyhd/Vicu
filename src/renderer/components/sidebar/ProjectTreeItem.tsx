import { useNavigate, useMatches } from '@tanstack/react-router'
import { SelectionPill } from './SelectionPill'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDndContext } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { ProgressRing } from '@/components/shared/ProgressRing'
import { useProjectProgress } from '@/hooks/use-project-progress'
import type { ProjectTreeNode } from '@/hooks/use-projects'

interface ProjectTreeItemProps {
  node: ProjectTreeNode
  depth?: number
  siblings: ProjectTreeNode[]
  /** Open tasks per project id (null while loading): the open side of every ring. */
  openCounts: ReadonlyMap<number, number> | null
  /** Whether rings are drawn at all (Settings); off, no done count is asked for either. */
  showProgress: boolean
  /** Ids of the collapsed projects; a project not in it shows its children. */
  collapsed: ReadonlySet<number>
  onToggleCollapsed: (id: number, collapse: boolean) => void
  onContextMenu?: (e: React.MouseEvent, node: ProjectTreeNode) => void
}

export function ProjectTreeItem({
  node,
  depth = 0,
  siblings,
  openCounts,
  showProgress,
  collapsed,
  onToggleCollapsed,
  onContextMenu,
}: ProjectTreeItemProps) {
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const { active } = useDndContext()

  const isActive = currentPath === `/project/${node.id}`
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && !collapsed.has(node.id)
  const color = normalizeHex(node.hex_color)
  const progress = useProjectProgress(node.id, openCounts, showProgress)

  const activeType = (active?.data.current as Record<string, unknown>)?.type as string | undefined

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
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
    paddingLeft: `${depth * 16 + 4}px`,
  }

  const open = () => navigate({ to: '/project/$projectId', params: { projectId: String(node.id) } })

  return (
    <>
      {/* The row is a box: the chevron and the project are two controls side by side, not one
          button inside another. Dragging starts on the project, never on the chevron. */}
      <div
        ref={setNodeRef}
        className={cn(
          'group relative flex h-7 cursor-default items-center rounded-control transition-colors',
          isTaskDragOver
            ? 'bg-accent-blue/15 ring-1 ring-[var(--accent-blue)]'
            : isActive
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
        )}
        style={style}
        onContextMenu={(e) => onContextMenu?.(e, node)}
      >
        {isActive && !isTaskDragOver && <SelectionPill />}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.title}`}
            aria-expanded={expanded}
            onClick={() => onToggleCollapsed(node.id, expanded)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ChevronRight
              className={cn('h-3 w-3 transition-transform duration-fade-fast motion-reduce:transition-none', expanded && 'rotate-90')}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span aria-hidden className="w-6 shrink-0" />
        )}

        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-current={isActive ? 'page' : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
          className="flex h-full min-w-0 flex-1 items-center"
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open()
            else if (e.key === 'ArrowRight' && hasChildren && !expanded) onToggleCollapsed(node.id, false)
            else if (e.key === 'ArrowLeft' && expanded) onToggleCollapsed(node.id, true)
          }}
        >
          <FolderOpen
            className="mr-2 h-3.5 w-3.5 shrink-0"
            style={{ color: color || 'var(--text-secondary)' }}
            strokeWidth={1.8}
          />

          <span className="min-w-0 flex-1 truncate text-xs">{node.title}</span>

          {showProgress && progress && <ProgressRing progress={progress} color={color} className="mx-2" />}
        </div>
      </div>

      {expanded && (
        <SortableContext items={node.children.map((child) => `project-${child.id}`)} strategy={verticalListSortingStrategy}>
          {node.children.map((child) => (
            <ProjectTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              siblings={node.children}
              openCounts={openCounts}
              showProgress={showProgress}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onContextMenu={onContextMenu}
            />
          ))}
        </SortableContext>
      )}
    </>
  )
}
