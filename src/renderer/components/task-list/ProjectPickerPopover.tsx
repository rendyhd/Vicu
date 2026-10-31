import { Fragment, useMemo, type RefObject } from 'react'
import { Check, FolderOpen } from 'lucide-react'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProjects } from '@/hooks/use-projects'
import { useProjectCategories } from '@/hooks/use-project-categories'
import { groupsWithInbox } from '@/lib/project-groups'
import type { ProjectTreeNode } from '@/hooks/use-projects'
import { Popover, type PopoverCloseReason } from '../overlay/Popover'
import { useProjectsWithoutIcon } from '@/hooks/use-project-icons'

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
  const { data: config } = useAppConfig()
  const { categories, layout } = useProjectCategories()
  const inboxId = config?.inbox_project_id ?? 0
  // With categories the projects come in the sidebar's groups, each under its category's name
  // (cross-app semantics 13.3); without, in tree order as always.
  const groups = useMemo(
    () => (data ? (categories.length > 0 ? groupsWithInbox(data.tree, layout, inboxId) : [{ category: null, nodes: data.tree }]) : []),
    [data, categories.length, layout, inboxId],
  )

  const handleSelect = (projectId: number) => {
    if (projectId !== currentProjectId) {
      onSelect(projectId)
    }
    onClose()
  }

  const empty = groups.every((group) => group.nodes.length === 0)

  const withoutIcon = useProjectsWithoutIcon()
  const options = (nodes: ProjectTreeNode[]) =>
    flattenTree(nodes).map(({ node, depth }) => (
      <button
        key={node.id}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={node.id === currentProjectId}
        onClick={() => handleSelect(node.id)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {!withoutIcon.has(node.id) && (
          <FolderOpen
            className="h-3 w-3 shrink-0"
            style={{ color: node.hex_color || 'var(--text-secondary)' }}
            strokeWidth={1.8}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{node.title}</span>
        {node.id === currentProjectId && (
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
        )}
      </button>
    ))

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} placement={placement} role="listbox" label="Move to project" className="w-56 py-1">
      {empty ? (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No projects</div>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {groups.map(({ category, nodes }) =>
            category ? (
              nodes.length > 0 && (
                <div key={category.id} role="group" aria-label={category.name}>
                  <div aria-hidden="true" className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-group font-medium text-text-secondary">
                    {category.name}
                  </div>
                  {options(nodes)}
                </div>
              )
            ) : (
              <Fragment key="no-category">{options(nodes)}</Fragment>
            ),
          )}
        </div>
      )}
    </Popover>
  )
}
