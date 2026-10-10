import { createContext, useCallback, useContext, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { confirmDelete } from '@/lib/confirm-bridge'
import { APP_CONFIG_QUERY_KEY } from '@/hooks/use-app-config'
import { useDeleteProject, useMoveProject, useSetProjectArchived } from '@/hooks/use-task-mutations'
import {
  excludeFromReviewRequest,
  markReviewedRequest,
  restoreReviewRequest,
  setReviewCadenceRequest,
} from '@/hooks/use-review'
import { undoPlacement, TOP_LEVEL, type ProjectPlacement } from '@/lib/project-moves'
import { announce } from '@/stores/announcer-store'
import { toast, UNDO_TOAST_MS } from '@/stores/toast-store'
import type { AppConfig, Project } from '@/lib/vikunja-types'

const MOVE_TOAST_KEY = 'project-move'
const REVIEW_TOAST_KEY = 'project-review'

/** The archive question, the same wherever a project is archived. */
export function archiveMessage(title: string): string {
  return `Archive “${title}”? Its tasks are kept. You can restore it from Archived, below your projects.`
}

/** The delete question, the same wherever a project is deleted. */
export function deleteMessage(title: string): string {
  return `Delete “${title}”? All tasks in it will be deleted. This cannot be undone.`
}

/** What a move did, in words: for the toast and for screen readers. */
export function moveDescription(
  title: string,
  placement: ProjectPlacement,
  projects: readonly Pick<Project, 'id' | 'title'>[],
): string {
  if (!placement.parentChanged) return `Moved “${title}”`
  if (placement.parentId === TOP_LEVEL) return `Moved “${title}” to the top level`
  const parent = projects.find((p) => p.id === placement.parentId)
  return parent ? `Moved “${title}” into “${parent.title}”` : `Moved “${title}”`
}

function activeProjects(qc: ReturnType<typeof useQueryClient>): Project[] {
  return (qc.getQueryData<Project[]>(['projects']) ?? []).filter((p) => !p.is_archived)
}

/**
 * Everything the project menu can do, shared by the sidebar, the Settings project list and the
 * project page. Confirmations go through the app-wide confirm dialog, so they still work after
 * the menu that asked for them has closed.
 */
export function useProjectActions() {
  const qc = useQueryClient()
  // `mutate` is stable across renders; the hook results themselves are not.
  const { mutate: setArchived } = useSetProjectArchived()
  const { mutate: deleteProject } = useDeleteProject()
  const { mutate: moveProject } = useMoveProject()

  const { mutate: review } = useMutation({
    meta: { action: 'save the review' },
    mutationFn: (request: () => Promise<Project | null>) => request(),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  /**
   * Move a project. A move to another parent shows a toast with Undo; `spoken` is what a screen
   * reader hears for a keyboard move ("Moved “Q4 planning” up").
   */
  const move = useCallback(
    (project: Project, placement: ProjectPlacement, spoken?: string) => {
      const before = activeProjects(qc)
      const message = moveDescription(project.title, placement, before)
      moveProject(
        { project, placement },
        {
          onSuccess: () => {
            if (!placement.parentChanged) return
            toast.success(message, {
              key: MOVE_TOAST_KEY,
              durationMs: UNDO_TOAST_MS,
              action: {
                label: 'Undo',
                onAction: () => {
                  const now = activeProjects(qc)
                  const current = now.find((p) => p.id === project.id)
                  const back = current ? undoPlacement(before, now, project.id) : null
                  if (current && back) moveProject({ project: current, placement: back })
                },
              },
            })
          },
        },
      )
      announce(spoken ?? message)
    },
    [qc, moveProject],
  )

  const archive = useCallback(
    async (project: Project, returnFocusTo?: HTMLElement | null) => {
      const ok = await confirmDelete(archiveMessage(project.title), {
        force: true,
        confirmLabel: 'Archive',
        destructive: false,
        returnFocusTo,
      })
      if (ok) setArchived({ project, archived: true })
    },
    [setArchived],
  )

  const restore = useCallback(
    (project: Project) => {
      setArchived({ project, archived: false }, { onSuccess: () => announce(`Restored “${project.title}”`) })
    },
    [setArchived],
  )

  const remove = useCallback(
    async (project: Project, returnFocusTo?: HTMLElement | null) => {
      const ok = await confirmDelete(deleteMessage(project.title), { returnFocusTo })
      if (ok) deleteProject(project.id)
    },
    [deleteProject],
  )

  /** Make a project the Inbox. Saved as a config patch, shown at once. */
  const setInbox = useCallback(
    async (project: Project) => {
      const previous = qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)
      if (previous) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...previous, inbox_project_id: project.id })
      try {
        await api.saveConfigPatch({ inbox_project_id: project.id })
        toast.success(`“${project.title}” is now the Inbox`)
      } catch (error) {
        if (previous) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, previous)
        const reason = error instanceof Error ? error.message : ''
        toast.error(reason ? `Could not change the Inbox: ${reason}` : 'Could not change the Inbox')
      } finally {
        qc.invalidateQueries({ queryKey: APP_CONFIG_QUERY_KEY })
      }
    },
    [qc],
  )

  const markReviewed = useCallback(
    (project: Project) => {
      review(() => markReviewedRequest(project), {
        onSuccess: () =>
          toast.success(`Marked ${project.title} reviewed`, {
            key: REVIEW_TOAST_KEY,
            durationMs: UNDO_TOAST_MS,
            action: { label: 'Undo', onAction: () => review(() => restoreReviewRequest(project)) },
          }),
      })
    },
    [review],
  )

  const setReviewCadence = useCallback(
    (project: Project, cadenceDays: number | null) => {
      review(() => setReviewCadenceRequest(project, cadenceDays))
    },
    [review],
  )

  const setExcludedFromReview = useCallback(
    (project: Project, excluded: boolean) => {
      review(() => excludeFromReviewRequest(project, excluded), {
        onSuccess: () =>
          announce(excluded ? `Excluded “${project.title}” from review` : `Included “${project.title}” in review`),
      })
    },
    [review],
  )

  return useMemo(
    () => ({ move, archive, restore, remove, setInbox, markReviewed, setReviewCadence, setExcludedFromReview }),
    [move, archive, restore, remove, setInbox, markReviewed, setReviewCadence, setExcludedFromReview],
  )
}

export type ProjectActions = ReturnType<typeof useProjectActions>

/**
 * The app's one set of project actions, provided by AppShell. A menu closes as soon as something
 * is chosen, so the work (and its Undo toast) has to belong to a component that stays mounted.
 */
export const ProjectActionsContext = createContext<ProjectActions | null>(null)

export function useSharedProjectActions(): ProjectActions {
  const actions = useContext(ProjectActionsContext)
  if (!actions) throw new Error('useSharedProjectActions needs the ProjectActionsContext from AppShell')
  return actions
}
