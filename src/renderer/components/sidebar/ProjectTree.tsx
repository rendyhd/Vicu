import { useState, useEffect, useMemo } from 'react'
import { Archive, Pencil, Plus, Trash2, X } from 'lucide-react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import { useCreateProject, useUpdateProject, useDeleteProject, useSetProjectArchived } from '@/hooks/use-task-mutations'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { useSidebarStore } from '@/stores/sidebar-store'
import { useOpenTaskCounts } from '@/hooks/use-project-progress'
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed'
import { useAppConfig } from '@/hooks/use-app-config'
import { cn } from '@/lib/cn'
import { focusTargetOf } from '@/lib/focus-target'
import { api } from '@/lib/api'
import { ProjectTreeItem } from './ProjectTreeItem'
import type { Project } from '@/lib/vikunja-types'

function ProjectDialog({
  open,
  project,
  parentProject = null,
  onClose,
}: {
  open: boolean
  project: Project | null
  /** Set (with no `project`) to add a section: a child project of this one. */
  parentProject?: Project | null
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
        {
          id: project.id,
          changes: { title: trimmed, hex_color: hexColor },
          original: project,
        },
        { onSuccess: onClose }
      )
    } else {
      createProject.mutate(
        {
          title: trimmed,
          hex_color: hexColor || undefined,
          ...(parentProject ? { parent_project_id: parentProject.id } : {}),
        },
        { onSuccess: onClose }
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="w-[360px] rounded-card border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {project ? 'Edit Project' : parentProject ? 'New Section' : 'New Project'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
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
              placeholder={parentProject ? 'Section name' : 'Project name'}
              autoFocus
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63', '#795548', '#607d8b', '#34495e', '#000000'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setHexColor(c)}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform hover:scale-110 motion-reduce:hover:scale-100',
                    hexColor === c && 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-primary)]'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="h-6 w-6 shrink-0 rounded-full border border-[var(--border-color)]"
                style={{ backgroundColor: hexColor || 'var(--bg-hover)' }}
              />
              <input
                type="text"
                value={hexColor}
                onChange={(e) => setHexColor(e.target.value)}
                placeholder="#hex"
                className="flex-1 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
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
            className="rounded-control border border-[var(--border-color)] px-4 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!title.trim()}
            className={cn(
              'rounded-control px-4 py-1.5 text-xs font-medium transition-colors',
              'bg-accent-fill text-on-accent hover:bg-accent-fill/90',
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
  const setArchived = useSetProjectArchived()
  const { confirmDelete, dialogProps: deleteDialogProps } = useConfirmDelete()
  const { projectDialogOpen, setProjectDialogOpen } = useSidebarStore()
  const openCounts = useOpenTaskCounts()
  const { collapsed, setCollapsed } = useSidebarCollapsed()

  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null)
  const [sectionParent, setSectionParent] = useState<Project | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    project: ProjectTreeNode
    /** The row's control: a confirmation opened from a menu entry gives focus back here. */
    opener: HTMLElement | null
  } | null>(null)
  const [archiveOpener, setArchiveOpener] = useState<HTMLElement | null>(null)

  // The tree waits for the config so the Inbox is never drawn (and counted) for a moment.
  const { data: config, isLoading: configLoading } = useAppConfig()
  const inboxProjectId = config?.inbox_project_id || undefined

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
    setContextMenu({ x: e.clientX, y: e.clientY, project: node, opener: focusTargetOf(e.currentTarget) })
  }

  const handleCloseDialog = () => {
    setProjectDialogOpen(false)
    setEditingProject(null)
  }

  if (isLoading || configLoading || !data) {
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
            <ProjectTreeItem
              key={node.id}
              node={node}
              siblings={visibleTree}
              openCounts={openCounts}
              collapsed={collapsed}
              onToggleCollapsed={setCollapsed}
              onContextMenu={handleContextMenu}
            />
          ))}
        </SortableContext>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-popover border border-[var(--border-color)] bg-[var(--bg-primary)] py-1 shadow-lg"
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
              setSectionParent(contextMenu.project)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add section
          </button>
          {contextMenu.project.id !== inboxProjectId && (
            <>
              <button
                type="button"
                onClick={() => {
                  setArchiveTarget(contextMenu.project)
                  setArchiveOpener(contextMenu.opener)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Archive className="h-3.5 w-3.5" />
                Archive
              </button>
              <button
                type="button"
                onClick={async () => {
                  const project = contextMenu.project
                  const opener = contextMenu.opener
                  setContextMenu(null)
                  const ok = await confirmDelete('Delete this project? All tasks in it will be deleted. This cannot be undone.', {
                    returnFocusTo: opener,
                  })
                  if (ok) {
                    deleteProject.mutate(project.id)
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-[var(--bg-hover)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          )}
        </div>
      )}

      <ProjectDialog
        open={projectDialogOpen}
        project={editingProject}
        onClose={handleCloseDialog}
      />
      <ProjectDialog
        open={sectionParent != null}
        project={null}
        parentProject={sectionParent}
        onClose={() => setSectionParent(null)}
      />
      <ConfirmDialog {...deleteDialogProps} />
      <ConfirmDialog
        open={archiveTarget != null}
        message={archiveTarget ? `Archive “${archiveTarget.title}”? Its tasks will be kept and it can be restored from Settings.` : ''}
        confirmLabel="Archive"
        destructive={false}
        returnFocusTo={archiveOpener}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) setArchived.mutate({ project: archiveTarget, archived: true })
          setArchiveTarget(null)
        }}
      />
    </>
  )
}
