import { useEffect, useMemo, useState } from 'react'
import { Archive, Folder, Pencil, Plus, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import { useAppConfig } from '@/hooks/use-app-config'
import { buildProjectTree, useProjects, type ProjectTreeNode } from '@/hooks/use-projects'
import {
  useCreateProject,
  useDeleteProject,
  useSetProjectArchived,
  useUpdateProject,
} from '@/hooks/use-task-mutations'
import { useConfirmDelete } from '@/hooks/use-confirm-delete'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/cn'
import type { Project } from '@/lib/vikunja-types'

function descendantIds(project: Project, projects: Project[]): Set<number> {
  const children = new Map<number, number[]>()
  for (const item of projects) {
    const siblings = children.get(item.parent_project_id) ?? []
    siblings.push(item.id)
    children.set(item.parent_project_id, siblings)
  }
  const result = new Set<number>()
  const pending = [...(children.get(project.id) ?? [])]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (result.has(id)) continue
    result.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return result
}

function ProjectEditor({
  project,
  projects,
  onClose,
}: {
  project: Project | null
  projects: Project[]
  onClose: () => void
}) {
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const [title, setTitle] = useState(project?.title ?? '')
  const [hexColor, setHexColor] = useState(project?.hex_color ?? '')
  const [parentId, setParentId] = useState(project?.parent_project_id ?? 0)
  const excluded = useMemo(
    () => project ? descendantIds(project, projects).add(project.id) : new Set<number>(),
    [project, projects],
  )
  const parentOptions = projects.filter((item) => !excluded.has(item.id))
  const mutation = project ? updateProject : createProject

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed) return
    if (project) {
      updateProject.mutate(
        {
          id: project.id,
          project: {
            title: trimmed,
            description: project.description,
            hex_color: hexColor,
            is_archived: project.is_archived,
            position: project.position,
            parent_project_id: parentId,
          },
        },
        { onSuccess: onClose },
      )
    } else {
      createProject.mutate(
        { title: trimmed, hex_color: hexColor || undefined, parent_project_id: parentId || undefined },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="w-[380px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{project ? 'Edit Project' : 'New Project'}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save() }} className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Parent project</label>
            <select value={parentId} onChange={(event) => setParentId(Number(event.target.value))} className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none">
              <option value={0}>None</option>
              {parentOptions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-[var(--text-secondary)]">Color</label>
            <input value={hexColor} onChange={(event) => setHexColor(event.target.value)} placeholder="#3498db" className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-accent-blue focus:outline-none" />
          </div>
          {mutation.error && <p className="text-xs text-accent-red">{mutation.error.message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--border-color)] px-4 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button>
          <button type="button" onClick={save} disabled={!title.trim() || mutation.isPending} className="rounded-md bg-accent-blue px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50">{mutation.isPending ? 'Saving…' : project ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </div>
  )
}

function ProjectRows({
  nodes,
  archived,
  inboxId,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  depth = 0,
}: {
  nodes: ProjectTreeNode[]
  archived: boolean
  inboxId: number
  onEdit: (project: Project) => void
  onArchive: (project: Project) => void
  onRestore: (project: Project) => void
  onDelete: (project: Project) => void
  depth?: number
}) {
  return nodes.map((node) => {
    const isInbox = node.id === inboxId
    return (
      <div key={node.id}>
        <div className="flex min-h-10 items-center gap-2 border-b border-[var(--border-color)]/60 py-1 pr-2" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <Folder className="h-4 w-4 shrink-0" style={{ color: node.hex_color || 'var(--text-secondary)' }} />
          <span className={cn('min-w-0 flex-1 truncate text-sm', archived ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>{node.title}</span>
          {isInbox && <span className="rounded bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">Inbox</span>}
          {!archived && (
            <button type="button" title="Edit" onClick={() => onEdit(node)} className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Pencil className="h-3.5 w-3.5" /></button>
          )}
          {archived ? (
            <button type="button" title="Restore" onClick={() => onRestore(node)} className="rounded p-1.5 text-accent-blue hover:bg-accent-blue/10"><RotateCcw className="h-3.5 w-3.5" /></button>
          ) : (
            <button type="button" title={isInbox ? 'Select another Inbox before archiving' : 'Archive'} disabled={isInbox} onClick={() => onArchive(node)} className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-30"><Archive className="h-3.5 w-3.5" /></button>
          )}
          {!isInbox && <button type="button" title="Delete" onClick={() => onDelete(node)} className="rounded p-1.5 text-accent-red hover:bg-accent-red/10"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        {node.children.length > 0 && <ProjectRows nodes={node.children} archived={archived} inboxId={inboxId} onEdit={onEdit} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} depth={depth + 1} />}
      </div>
    )
  })
}

export function ProjectSettings() {
  const { data, isLoading, isFetching, error, refetch } = useProjects()
  const { data: config } = useAppConfig()
  const setArchived = useSetProjectArchived()
  const deleteProject = useDeleteProject()
  const { confirmDelete, dialogProps } = useConfirmDelete()
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<Project | null | undefined>(undefined)
  const [archiveTarget, setArchiveTarget] = useState<Project | null>(null)
  const archivedTree = useMemo(() => buildProjectTree(data?.archived ?? []), [data?.archived])
  const inboxId = config?.inbox_project_id ?? 0

  useEffect(() => {
    void refetch()
  }, [refetch])

  const remove = async (project: Project) => {
    const ok = await confirmDelete(`Delete “${project.title}”? All tasks in it will be deleted. This cannot be undone.`)
    if (ok) deleteProject.mutate(project.id)
  }

  return (
    <div className="mx-6 max-w-2xl space-y-4 pb-8 pt-4">
      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]">
        <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Projects</h2>
            <p className="text-xs text-[var(--text-secondary)]">Archive projects without deleting their tasks.</p>
          </div>
          <button type="button" title="Refresh projects" onClick={() => refetch()} disabled={isFetching} className="rounded p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"><RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} /></button>
          <button type="button" onClick={() => setEditing(null)} className="flex items-center gap-1.5 rounded-md bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/90"><Plus className="h-3.5 w-3.5" />New project</button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 border-b border-[var(--border-color)] px-4 py-2.5">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} className="h-4 w-4 rounded border-[var(--border-color)] accent-accent-blue" />
          <span className="text-sm text-[var(--text-primary)]">Show archived projects</span>
          <span className="text-xs text-[var(--text-secondary)]">({data?.archived.length ?? 0})</span>
        </label>
        {isLoading ? <p className="px-4 py-5 text-sm text-[var(--text-secondary)]">Loading projects…</p> : error ? <p className="px-4 py-5 text-sm text-accent-red">{error.message}</p> : data?.tree.length ? <ProjectRows nodes={data.tree} archived={false} inboxId={inboxId} onEdit={setEditing} onArchive={setArchiveTarget} onRestore={(project) => setArchived.mutate({ project, archived: false })} onDelete={remove} /> : <p className="px-4 py-5 text-sm text-[var(--text-secondary)]">No active projects</p>}
        {showArchived && (
          <div>
            <div className="border-y border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Archived</div>
            {archivedTree.length ? <ProjectRows nodes={archivedTree} archived inboxId={inboxId} onEdit={setEditing} onArchive={setArchiveTarget} onRestore={(project) => setArchived.mutate({ project, archived: false })} onDelete={remove} /> : <p className="px-4 py-5 text-sm text-[var(--text-secondary)]">No archived projects</p>}
          </div>
        )}
        {(setArchived.error || deleteProject.error) && <p className="border-t border-[var(--border-color)] px-4 py-3 text-xs text-accent-red">{setArchived.error?.message ?? deleteProject.error?.message}</p>}
      </div>
      {editing !== undefined && <ProjectEditor project={editing} projects={data?.flat ?? []} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog {...dialogProps} />
      <ConfirmDialog open={archiveTarget != null} message={archiveTarget ? `Archive “${archiveTarget.title}”? Its tasks will be kept and the project can be restored from Settings.` : ''} confirmLabel="Archive" destructive={false} onCancel={() => setArchiveTarget(null)} onConfirm={() => { if (archiveTarget) setArchived.mutate({ project: archiveTarget, archived: true }); setArchiveTarget(null) }} />
    </div>
  )
}
