import { useState, useEffect, useMemo } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import { useCreateProject, useUpdateProject, useDeleteProject } from '@/hooks/use-task-mutations'
import { useSidebarStore } from '@/stores/sidebar-store'
import { cn } from '@/lib/cn'
import { api } from '@/lib/api'
import { ProjectTreeItem } from './ProjectTreeItem'
import type { Project } from '@/lib/vikunja-types'

function ProjectDialog({
  open,
  project,
  onClose,
}: {
  open: boolean
  project: Project | null
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [hexColor, setHexColor] = useState('')
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()

  useEffect(() => {
    if (open) {
      setTitle(project?.title ?? '')
      setHexColor(project?.hex_color ?? '')
    }
  }, [open, project])

  if (!open) return null

  const handleSave = () => {
    const trimmed = title.trim()
    if (!trimmed) return

    if (project) {
      updateProject.mutate(
        { id: project.id, project: { title: trimmed, hex_color: hexColor || undefined } },
        { onSuccess: onClose }
      )
    } else {
      createProject.mutate(
        { title: trimmed, hex_color: hexColor || undefined },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[360px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {project ? 'Edit Project' : 'New Project'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project name"
              autoFocus
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexColor || '#6b7280'}
                onChange={(e) => setHexColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-[var(--border-color)]"
              />
              <input
                type="text"
                value={hexColor}
                onChange={(e) => setHexColor(e.target.value)}
                placeholder="#hex"
                className="flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-accent-blue focus:outline-none"
              />
              {hexColor && (
                <button
                  type="button"
                  onClick={() => setHexColor('')}
                  className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!title.trim()}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-medium transition-colors',
              'bg-accent-blue text-white hover:bg-accent-blue/90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {project ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProjectTree() {
  const { data, isLoading } = useProjects()
  const deleteProject = useDeleteProject()
  const { projectDialogOpen, setProjectDialogOpen } = useSidebarStore()

  const [inboxProjectId, setInboxProjectId] = useState<number | undefined>()
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    project: ProjectTreeNode
  } | null>(null)

  useEffect(() => {
    api.getConfig().then((config) => {
      if (config?.inbox_project_id) setInboxProjectId(config.inbox_project_id)
    })
  }, [])

  const visibleTree = useMemo(
    () => (inboxProjectId ? data?.tree.filter((n) => n.id !== inboxProjectId) : data?.tree) ?? [],
    [data?.tree, inboxProjectId]
  )

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent, node: ProjectTreeNode) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, project: node })
  }

  const handleCloseDialog = () => {
    setProjectDialogOpen(false)
    setEditingProject(null)
  }

  if (isLoading || !data) {
    return (
      <div className="px-4 py-2 text-xs text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  if (visibleTree.length === 0) {
    return (
      <>
        <div className="px-4 py-2 text-xs text-[var(--text-secondary)]">
          No projects
        </div>
        <ProjectDialog
          open={projectDialogOpen}
          project={editingProject}
          onClose={handleCloseDialog}
        />
      </>
    )
  }

  const sortableIds = visibleTree.map((n) => `project-${n.id}`)

  return (
    <>
      <div className="flex flex-col gap-0.5 px-2">
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {visibleTree.map((node) => (
            <ProjectTreeItem key={node.id} node={node} siblings={visibleTree} onContextMenu={handleContextMenu} />
          ))}
        </SortableContext>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setEditingProject(contextMenu.project)
              setProjectDialogOpen(true)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              deleteProject.mutate(contextMenu.project.id)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-accent-red hover:bg-[var(--bg-hover)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}

      <ProjectDialog
        open={projectDialogOpen}
        project={editingProject}
        onClose={handleCloseDialog}
      />
    </>
  )
}
