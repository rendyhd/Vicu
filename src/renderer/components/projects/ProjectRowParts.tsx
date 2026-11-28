import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen } from 'lucide-react'
import { useAppConfig } from '@/hooks/use-app-config'
import { useSharedProjectActions } from '@/hooks/use-project-actions'
import { commitProjectMove } from '@/hooks/use-project-categories'
import { SYNCED_PREFS_QUERY_KEY } from '@/hooks/use-synced-prefs'
import { useCreateProject, useUpdateProject } from '@/hooks/use-task-mutations'
import { cn } from '@/lib/cn'
import { keyboardProjectMove } from '@/lib/project-category-moves'
import { type DropZone, type KeyboardMove } from '@/lib/project-moves'
import { t, type TranslationKey } from '../../../shared/i18n'
import { projectActions, type ProjectSurface } from '@/stores/project-actions-store'
import type { Project } from '@/lib/vikunja-types'
import type { SyncedPrefsSnapshot } from '../../../shared/synced-prefs'

/** The project row with this id on a surface: focus goes back to it after a keyboard move. */
export const projectRowSelector = (surface: ProjectSurface, id: number) =>
  `[data-project-row="${surface}:${id}"]`

const KEY_MOVES: Record<string, KeyboardMove> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowRight: 'in',
  ArrowLeft: 'out',
}

const SPOKEN: Record<KeyboardMove, TranslationKey> = {
  up: 'projects.row.movedUp',
  down: 'projects.row.movedDown',
  in: 'projects.row.movedIn',
  out: 'projects.row.movedOut',
}

/**
 * Keys on a focused project row: F2 renames, Shift+F10 or the menu key opens the project menu,
 * Alt+Shift+arrows move it (up, down, in under the project above, out one level; a top-level
 * project moves within its category). Returns true when it handled the key.
 */
export function useProjectRowKeys(project: Project, surface: ProjectSurface, openMenu: () => void) {
  const qc = useQueryClient()
  const { data: config } = useAppConfig()
  const { move } = useSharedProjectActions()

  return (event: React.KeyboardEvent<HTMLElement>): boolean => {
    if (event.key === 'F2') {
      event.preventDefault()
      projectActions.startRename(project.id, surface)
      return true
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault()
      openMenu()
      return true
    }
    const keyMove = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey ? KEY_MOVES[event.key] : undefined
    if (!keyMove || project.is_archived) return false
    event.preventDefault()
    const projects = (qc.getQueryData<Project[]>(['projects']) ?? []).filter((p) => !p.is_archived)
    const inboxId = config?.inbox_project_id ?? 0
    const values = qc.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)?.values ?? {}
    const planned = keyboardProjectMove(projects, inboxId, values, project.id, keyMove)
    if (!planned) return true
    const spoken = planned.placement?.parentChanged ? undefined : t(SPOKEN[keyMove], { title: project.title })
    commitProjectMove(qc, move, project, planned, spoken)
    // The row may be drawn again elsewhere in the tree: keep the focus on it.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(projectRowSelector(surface, project.id))?.focus({ preventScroll: false })
    })
    return true
  }
}

/** The line or highlight that shows where a dragged project would land on this row. */
export function DropLine({ zone, indent }: { zone: DropZone | null; indent: number }) {
  if (zone !== 'before' && zone !== 'after') return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute right-1 z-10 h-0.5 rounded-full bg-accent-fill',
        zone === 'before' ? '-top-px' : '-bottom-px',
      )}
      style={{ left: indent }}
    />
  )
}

export const INTO_CLASSES = 'bg-accent-blue/15 ring-1 ring-[var(--accent-blue)]'

/** Rename a project in place: Enter or leaving the field saves, Escape cancels. */
export function ProjectRenameInput({
  project,
  surface,
  className,
}: {
  project: Project
  surface: ProjectSurface
  className?: string
}) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(project.title)
  const updateProject = useUpdateProject()
  const done = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const finish = (save: boolean, refocus = false) => {
    if (done.current) return
    done.current = true
    const trimmed = title.trim()
    if (save && trimmed && trimmed !== project.title) {
      updateProject.mutate({ id: project.id, changes: { title: trimmed }, original: project })
    }
    projectActions.stopRename()
    // From the keyboard, focus goes back to the row; a click elsewhere keeps its own focus.
    if (refocus) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(projectRowSelector(surface, project.id))?.focus())
    }
  }

  return (
    <input
      ref={inputRef}
      value={title}
      aria-label={t('projects.row.rename', { title: project.title })}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true, true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false, true)
        }
      }}
      onBlur={() => finish(true)}
      className={cn(
        'min-w-0 flex-1 rounded-control border border-[var(--accent-blue)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-[var(--text-primary)] focus:outline-none',
        className,
      )}
    />
  )
}

/**
 * An editable "new project" row (the sidebar's +, or Add subproject there). Enter creates the
 * project, Escape cancels, leaving the field creates it when something was typed.
 */
export function ProjectCreateRow({ parentId, depth }: { parentId: number; depth: number }) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const createProject = useCreateProject()
  const done = useRef(false)

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    const trimmed = title.trim()
    if (save && trimmed) {
      createProject.mutate({ title: trimmed, ...(parentId ? { parent_project_id: parentId } : {}) })
    }
    projectActions.stopCreate()
  }

  return (
    <div className="flex flex-col">
      <div className="flex h-7 items-center rounded-control" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        <span aria-hidden className="w-6 shrink-0" />
        <FolderOpen aria-hidden="true" className="mr-2 h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" strokeWidth={1.8} />
        <input
          autoFocus
          value={title}
          placeholder={parentId ? t('projects.row.subprojectName') : t('projects.row.projectName')}
          aria-label={parentId ? t('projects.row.newSubprojectName') : t('projects.row.newProjectName')}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              finish(true)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              finish(false)
            }
          }}
          onBlur={() => finish(true)}
          className="mr-2 min-w-0 flex-1 rounded-control border border-[var(--accent-blue)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none placeholder:text-[var(--text-secondary)]"
        />
      </div>
      <p className="pb-1 text-caption text-[var(--text-secondary)]" style={{ paddingLeft: `${depth * 16 + 46}px` }}>
        {t('projects.row.createHint')}
      </p>
    </div>
  )
}
