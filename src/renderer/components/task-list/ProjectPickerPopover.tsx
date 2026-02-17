import { useRef, useEffect } from 'react'
import { Check, FolderOpen } from 'lucide-react'
import { useProjects } from '@/hooks/use-projects'
import { useUpdateTask } from '@/hooks/use-task-mutations'
import type { Task } from '@/lib/vikunja-types'
import type { ProjectTreeNode } from '@/hooks/use-projects'

interface ProjectPickerPopoverProps {
  task: Task
  onClose: () => void
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

export function ProjectPickerPopover({ task, onClose }: ProjectPickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useProjects()
  const updateTask = useUpdateTask()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const handleSelect = (projectId: number) => {
    if (projectId !== task.project_id) {
      updateTask.mutate({ id: task.id, task: { ...task, project_id: projectId } })
    }
    onClose()
  }

  const items = data ? flattenTree(data.tree) : []

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No projects</div>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          {items.map(({ node, depth }) => (
            <button
              key={node.id}
              type="button"
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
              {node.id === task.project_id && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-blue)]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
