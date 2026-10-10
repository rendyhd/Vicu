import { useRef } from 'react'
import { useNavigate, useMatches } from '@tanstack/react-router'
import { SelectionPill } from './SelectionPill'
import { ChevronRight, FolderOpen, MoreHorizontal } from 'lucide-react'
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { cn } from '@/lib/cn'
import { normalizeHex } from '@/lib/constants'
import { ProgressRing } from '@/components/shared/ProgressRing'
import {
  DropLine,
  INTO_CLASSES,
  ProjectCreateRow,
  ProjectRenameInput,
  useProjectRowKeys,
} from '@/components/projects/ProjectRowParts'
import { useProjectProgress } from '@/hooks/use-project-progress'
import { useRowDropZone } from '@/stores/project-drop-store'
import type { ProjectTreeNode } from '@/hooks/use-projects'

/** How the tree asks for the project menu: at the pointer (right-click) or at the … button. */
export type OpenProjectMenu = (
  node: ProjectTreeNode,
  at: { point: { x: number; y: number } } | { anchor: HTMLElement },
  opener: HTMLElement | null,
) => void

interface ProjectTreeItemProps {
  node: ProjectTreeNode
  depth?: number
  /** Open tasks per project id (null while loading): the open side of every ring. */
  openCounts: ReadonlyMap<number, number> | null
  /** Whether rings are drawn at all (Settings); off, no done count is asked for either. */
  showProgress: boolean
  /** Ids of the collapsed projects; a project not in it shows its children. */
  collapsed: ReadonlySet<number>
  onToggleCollapsed: (id: number, collapse: boolean) => void
  onOpenMenu: OpenProjectMenu
  /** The project whose menu is open: its … button stays visible. */
  menuOpenFor: number | null
  /** The project renamed in place in the sidebar, if any. */
  renamingId: number | null
  /** The project an editable "new subproject" row is shown under, if any. */
  creatingUnder: number | null
}

export function ProjectTreeItem(props: ProjectTreeItemProps) {
  const {
    node,
    depth = 0,
    openCounts,
    showProgress,
    collapsed,
    onToggleCollapsed,
    onOpenMenu,
    menuOpenFor,
    renamingId,
    creatingUnder,
  } = props
  const navigate = useNavigate()
  const matches = useMatches()
  const currentPath = matches[matches.length - 1]?.pathname ?? ''
  const { active } = useDndContext()
  const moreRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)

  const isActive = currentPath === `/project/${node.id}`
  const hasChildren = node.children.length > 0
  const expanded = hasChildren && !collapsed.has(node.id)
  const color = normalizeHex(node.hex_color)
  const progress = useProjectProgress(node.id, openCounts, showProgress)
  const renaming = renamingId === node.id
  const menuOpen = menuOpenFor === node.id

  const activeType = (active?.data.current as Record<string, unknown>)?.type as string | undefined
  const dndId = `project-${node.id}`
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({ id: dndId, data: { type: 'project', projectId: node.id, node, surface: 'sidebar' } })
  // The row is also where tasks are dropped to move them into the project.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dndId,
    data: { type: 'project', projectId: node.id, node, hasVisibleChildren: expanded },
  })
  const zone = useRowDropZone(dndId)

  const isTaskDragOver = isOver && activeType === 'task'
  const highlighted = isTaskDragOver || zone === 'into'
  const indent = depth * 16 + 4

  const open = () => navigate({ to: '/project/$projectId', params: { projectId: String(node.id) } })
  const openMenuAtButton = () => {
    if (moreRef.current) onOpenMenu(node, { anchor: moreRef.current }, rowRef.current)
  }
  const handleRowKeys = useProjectRowKeys(node, 'sidebar', openMenuAtButton)

  return (
    <>
      {/* The row is a box: the chevron, the project and its … button are controls side by side,
          not one button inside another. Dragging starts on the project, never on the others. */}
      <div
        ref={setDropRef}
        data-sidebar-project={node.id}
        className={cn(
          'group relative flex h-7 cursor-default items-center rounded-control transition-colors',
          highlighted
            ? INTO_CLASSES
            : isActive
              ? 'text-[var(--text-primary)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
          menuOpen && !isActive && !highlighted && 'bg-[var(--bg-hover)]',
        )}
        style={{ opacity: isDragging ? 0.4 : undefined, paddingLeft: `${indent}px` }}
        onContextMenu={(event) => {
          event.preventDefault()
          onOpenMenu(node, { point: { x: event.clientX, y: event.clientY } }, rowRef.current)
        }}
      >
        {isActive && !highlighted && <SelectionPill />}
        <DropLine zone={zone} indent={indent + 24} />
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

        {renaming ? (
          <div className="flex h-full min-w-0 flex-1 items-center">
            <FolderOpen aria-hidden="true" className="mr-2 h-3.5 w-3.5 shrink-0" style={{ color: color || 'var(--text-secondary)' }} strokeWidth={1.8} />
            <ProjectRenameInput project={node} surface="sidebar" className="text-xs" />
          </div>
        ) : (
          <div
            ref={(element) => {
              setDragRef(element)
              rowRef.current = element
            }}
            {...attributes}
            {...listeners}
            role="button"
            tabIndex={0}
            data-project-row={`sidebar:${node.id}`}
            aria-current={isActive ? 'page' : undefined}
            aria-expanded={hasChildren ? expanded : undefined}
            aria-keyshortcuts="F2 Shift+F10 Alt+Shift+ArrowUp Alt+Shift+ArrowDown Alt+Shift+ArrowRight Alt+Shift+ArrowLeft"
            className="flex h-full min-w-0 flex-1 items-center"
            onClick={open}
            onKeyDown={(event) => {
              if (handleRowKeys(event)) return
              if (event.key === 'Enter') open()
              else if (event.key === 'ArrowRight' && hasChildren && !expanded) onToggleCollapsed(node.id, false)
              else if (event.key === 'ArrowLeft' && expanded) onToggleCollapsed(node.id, true)
            }}
          >
            <FolderOpen
              aria-hidden="true"
              className="mr-2 h-3.5 w-3.5 shrink-0"
              style={{ color: color || 'var(--text-secondary)' }}
              strokeWidth={1.8}
            />
            <span className="min-w-0 flex-1 truncate text-xs">{node.title}</span>
          </div>
        )}

        {/* One slot at the right edge: the progress ring, or the … button on hover and focus. */}
        <span className="relative mx-1.5 flex h-5 w-5 shrink-0 items-center justify-center">
          {showProgress && progress && (
            <ProgressRing
              progress={progress}
              color={color}
              className={cn('group-hover:hidden group-focus-within:hidden', menuOpen && 'hidden')}
            />
          )}
          <button
            ref={moreRef}
            type="button"
            tabIndex={-1}
            aria-label={`${node.title} actions`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={openMenuAtButton}
            className={cn(
              'absolute inset-0 items-center justify-center rounded-control text-[var(--text-secondary)] hover:bg-[var(--bg-selected)] hover:text-[var(--text-primary)]',
              menuOpen ? 'flex text-[var(--text-primary)]' : isDragging ? 'hidden' : 'hidden group-hover:flex group-focus-within:flex',
            )}
          >
            <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {expanded &&
        node.children.map((child) => (
          <ProjectTreeItem key={child.id} {...props} node={child} depth={depth + 1} />
        ))}
      {creatingUnder === node.id && <ProjectCreateRow parentId={node.id} depth={depth + 1} />}
    </>
  )
}
