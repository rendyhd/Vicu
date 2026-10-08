import type { RefObject } from 'react'
import { Check, FolderOpen } from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import type { ProjectTreeNode } from '@/hooks/use-projects'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'

interface ProjectPickerPopoverProps {
  anchorRef: RefObject<HTMLElement | null>
  /** Where it opens relative to the anchor; a menu entry opens it beside the menu. */
  placement?: 'bottom-start' | 'right-start'
  /** The task(s)' current project — shows a checkmark; undefined for a mixed multi-selection. */
  currentProjectId?: number
  /** Called with the chosen project id. The caller owns the move mutation(s). */
  onSelect: (projectId: number) => void
  onClose: (reason?: PopoverCloseReason) => void
}

function flattenTree(nodes: ProjectTreeNode[], depth = 0): { node: ProjectTreeNode; depth: number }[] {
  const result: { node: ProjectTreeNode; depth: number }[] = []
  for (const n of nodes) {
    result.push({ node: n, depth })
    if (n.children.length > 0) {
      result.push(...flattenTree(n.children, depth + 1))
    }
  }
  return result
}

export function ProjectPickerPopover({ anchorRef, placement = 'bottom-start', currentProjectId, onSelect, onClose }: ProjectPickerPopoverProps) {
  const { data } = useProjects()

  const handleSelect = (projectId: number) => {
    if (projectId !== currentProjectId) {
      onSelect(projectId)
    }
    onClose()
  }

  const items = data ? flattenTree(data.tree) : []

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} role="listbox" label="Move to project" className="w-56 py-1">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No projects</div>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {items.map(({ node, depth }) => (
            <button
              key={node.id}
              type="button"
              role="option"
              aria-selected={node.id === currentProjectId}
              onClick={() => handleSelect(node.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              style={{ paddingLeft: `${depth * 12 + 12}px` }}
            >
              <FolderOpen
                className="h-3 w-3 shrink-0"
                style={{ color: node.hex_color || 'var(--text-secondary)' }}
                strokeWidth={1.8}
              />
              <span className="min-w-0 flex-1 truncate">{node.title}</span>
              {node.id === currentProjectId && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
