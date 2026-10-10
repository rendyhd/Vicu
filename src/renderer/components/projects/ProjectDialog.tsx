import { useId, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '@/components/overlay/Dialog'
import { Button } from '@/components/shared/Button'
import { useAppConfig } from '@/hooks/use-app-config'
import { useProjects } from '@/hooks/use-projects'
import { useCreateProject, useUpdateProject } from '@/hooks/use-task-mutations'
import { cn } from '@/lib/cn'
import { childrenOf, descendantIds, effectiveParent, placeAt, TOP_LEVEL } from '@/lib/project-moves'
import type { Project } from '@/lib/vikunja-types'

export const PROJECT_COLORS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db',
  '#9b59b6', '#e91e63', '#795548', '#607d8b', '#34495e', '#000000',
]

/** The active projects as indented options, depth first. */
export function parentOptions(projects: readonly Project[], exclude: ReadonlySet<number>): { project: Project; depth: number }[] {
  const out: { project: Project; depth: number }[] = []
  const walk = (parentId: number, depth: number) => {
    for (const child of childrenOf(projects, parentId)) {
      if (exclude.has(child.id)) continue
      out.push({ project: child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(TOP_LEVEL, 0)
  return out
}

interface ProjectDialogProps {
  /** The project to edit, or null to create one. */
  project: Project | null
  /** The parent a new project starts under (0 = top level). */
  initialParentId?: number
  returnFocusTo?: HTMLElement | null
  onClose: () => void
}

/**
 * The one project dialog: name, parent and colour, for a new project, a new subproject and an
 * edit, from the sidebar, the project page and Settings alike.
 */
export function ProjectDialog({ project, initialParentId = TOP_LEVEL, returnFocusTo, onClose }: ProjectDialogProps) {
  const titleId = useId()
  const nameId = useId()
  const parentId = useId()
  const { data } = useProjects()
  const { data: config } = useAppConfig()
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const active = useMemo(() => data?.flat ?? [], [data?.flat])
  const inboxId = config?.inbox_project_id ?? 0

  const [title, setTitle] = useState(project?.title ?? '')
  const [hexColor, setHexColor] = useState(project?.hex_color ? `#${project.hex_color.replace(/^#/, '')}` : '')
  const [parent, setParent] = useState(project ? effectiveParent(project, active) : initialParentId)

  // Never under itself or its own projects, and never under the Inbox (the sidebar hides the
  // Inbox, so projects inside it would disappear from the tree).
  const options = useMemo(() => {
    const exclude = project ? descendantIds(project.id, active).add(project.id) : new Set<number>()
    if (inboxId) exclude.add(inboxId)
    return parentOptions(active, exclude)
  }, [active, project, inboxId])

  const mutation = project ? updateProject : createProject
  const pending = mutation.isPending

  const save = () => {
    const trimmed = title.trim()
    if (!trimmed || pending) return
    if (project) {
      const changes: Partial<Project> = { title: trimmed, hex_color: hexColor }
      if (parent !== effectiveParent(project, active)) {
        // A new parent puts the project at the end of its new siblings.
        const placement = placeAt(active, project.id, parent, childrenOf(active, parent).length)
        if (placement) {
          changes.parent_project_id = placement.parentId
          changes.position = placement.position
        }
      }
      updateProject.mutate({ id: project.id, changes, original: project }, { onSuccess: onClose })
    } else {
      createProject.mutate(
        { title: trimmed, hex_color: hexColor || undefined, ...(parent ? { parent_project_id: parent } : {}) },
        { onSuccess: onClose },
      )
    }
  }

  const heading = project ? 'Edit Project' : parent ? 'New Subproject' : 'New Project'

  return (
    <Dialog open onClose={onClose} labelledBy={titleId} returnFocusTo={returnFocusTo} className="w-[380px]">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--text-primary)]">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor={nameId} className="mb-1 block text-xs text-[var(--text-secondary)]">Name</label>
            <input
              id={nameId}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project name"
              data-autofocus
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
          </div>

          <div>
            <label htmlFor={parentId} className="mb-1 block text-xs text-[var(--text-secondary)]">Parent project</label>
            <select
              id={parentId}
              value={parent}
              onChange={(event) => setParent(Number(event.target.value))}
              className="w-full rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value={TOP_LEVEL}>None (top level)</option>
              {options.map(({ project: option, depth }) => (
                <option key={option.id} value={option.id}>
                  {'   '.repeat(depth)}
                  {option.title}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="mb-1 block text-xs text-[var(--text-secondary)]">Color</legend>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={hexColor.toLowerCase() === color}
                  onClick={() => setHexColor(color)}
                  className={cn(
                    'h-6 w-6 rounded-full border border-black/10 transition-transform duration-fade-fast hover:scale-110 motion-reduce:hover:scale-100',
                    hexColor.toLowerCase() === color && 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-primary)]',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-6 w-6 shrink-0 rounded-full border border-[var(--border-color)]"
                style={{ backgroundColor: hexColor || 'var(--bg-hover)' }}
              />
              <input
                type="text"
                aria-label="Color as a hex value"
                value={hexColor}
                onChange={(event) => setHexColor(event.target.value)}
                placeholder="#hex"
                className="flex-1 rounded-control border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
              />
              {hexColor && (
                <Button variant="quiet" onClick={() => setHexColor('')}>
                  Clear
                </Button>
              )}
            </div>
          </fieldset>
          {mutation.error && <p className="text-xs text-danger">{mutation.error.message}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!title.trim() || pending}>
            {pending ? 'Saving…' : project ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
