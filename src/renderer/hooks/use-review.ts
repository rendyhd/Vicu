import { useMemo } from 'react'
import { useProjects } from './use-projects'
import type { ProjectTreeNode } from './use-projects'
import { useAppConfig } from './use-app-config'
import { useUpdateProject } from './use-task-mutations'
import {
  parseReviewFooter,
  computeStatus,
  upsertFooter,
  todayLocalIsoDate,
  type ReviewStatus,
  type ReviewMetadata,
} from '@/lib/review-metadata'
import { useReviewNoticeStore } from '@/stores/review-notice-store'
import type { Project, AppConfig } from '@/lib/vikunja-types'

export interface ProjectWithStatus {
  project: Project
  status: ReviewStatus
}

function selectProjects(
  projects: Project[] | undefined,
  cfg: AppConfig | null | undefined,
  predicate: (s: ReviewStatus) => boolean,
): ProjectWithStatus[] {
  if (!projects || !cfg?.review?.enabled) return []
  const defaultCadence = cfg.review.default_cadence_days
  const excludeInbox = cfg.review.exclude_inbox
  const inboxId = cfg.inbox_project_id
  const now = new Date()
  return projects
    .filter((p) => !p.is_archived)
    .filter((p) => !(excludeInbox && p.id === inboxId))
    .map((p): ProjectWithStatus => {
      const meta = parseReviewFooter(p.description)
      const status = computeStatus(meta, defaultCadence, now)
      return { project: p, status }
    })
    .filter(({ status }) => status.metadata.state !== 'excluded' && predicate(status))
    .sort((a, b) => {
      const av = a.status.daysUntilDue ?? Number.MIN_SAFE_INTEGER
      const bv = b.status.daysUntilDue ?? Number.MIN_SAFE_INTEGER
      return av - bv
    })
}

export function useProjectsNeedingReview() {
  const { data: projectsData, isLoading: projectsLoading } = useProjects()
  const { data: cfg, isLoading: cfgLoading } = useAppConfig()
  const data = useMemo(
    () => selectProjects(projectsData?.flat, cfg, (s) => s.isOverdue),
    [projectsData, cfg],
  )
  return { data, isLoading: projectsLoading || cfgLoading }
}

export function useTrackedProjects() {
  const { data: projectsData, isLoading: projectsLoading } = useProjects()
  const { data: cfg, isLoading: cfgLoading } = useAppConfig()
  const data = useMemo(
    () => selectProjects(projectsData?.flat, cfg, () => true),
    [projectsData, cfg],
  )
  return { data, isLoading: projectsLoading || cfgLoading }
}

export function useReviewBadgeCount(): number {
  const { data } = useProjectsNeedingReview()
  return data.length
}

export function useReviewFeatureEnabled(): boolean {
  const { data: cfg } = useAppConfig()
  return cfg?.review?.enabled ?? true
}

// ---- Hierarchical tree (for the Review screen) ----

export interface ReviewTreeNode {
  project: Project
  status: ReviewStatus
  children: ReviewTreeNode[]
}

const EMPTY_KEEP: ReadonlySet<number> = new Set()

function buildTrackedTree(
  nodes: ProjectTreeNode[],
  defaultCadence: number,
  excludeInbox: boolean,
  inboxId: number,
  now: Date,
): ReviewTreeNode[] {
  const result: ReviewTreeNode[] = []
  for (const node of nodes) {
    if (node.is_archived) continue
    if (excludeInbox && node.id === inboxId) continue
    const meta = parseReviewFooter(node.description)
    const status = computeStatus(meta, defaultCadence, now)
    if (status.metadata.state === 'excluded') continue
    const children = buildTrackedTree(node.children, defaultCadence, excludeInbox, inboxId, now)
    result.push({ project: node, status, children })
  }
  return result
}

// Keep a branch when the node itself is overdue, was reviewed this session
// (so it stays visible + faded instead of vanishing on refetch), or has a kept
// descendant — preserving hierarchy context above due children.
function pruneToDue(nodes: ReviewTreeNode[], keepVisible: ReadonlySet<number>): ReviewTreeNode[] {
  const out: ReviewTreeNode[] = []
  for (const node of nodes) {
    const children = pruneToDue(node.children, keepVisible)
    if (node.status.isOverdue || keepVisible.has(node.project.id) || children.length > 0) {
      out.push({ ...node, children })
    }
  }
  return out
}

export function useReviewTree(filter: 'due' | 'all', keepVisible: ReadonlySet<number> = EMPTY_KEEP) {
  const { data: projectsData, isLoading: projectsLoading } = useProjects()
  const { data: cfg, isLoading: cfgLoading } = useAppConfig()
  const data = useMemo<ReviewTreeNode[]>(() => {
    if (!projectsData?.tree || !cfg?.review?.enabled) return []
    const now = new Date()
    const tracked = buildTrackedTree(
      projectsData.tree,
      cfg.review.default_cadence_days,
      cfg.review.exclude_inbox,
      cfg.inbox_project_id,
      now,
    )
    return filter === 'all' ? tracked : pruneToDue(tracked, keepVisible)
  }, [projectsData, cfg, filter, keepVisible])
  return { data, isLoading: projectsLoading || cfgLoading }
}

// DFS flatten, parents before children — used for keyboard nav + counts.
export function flattenReviewTree(nodes: ReviewTreeNode[]): ReviewTreeNode[] {
  const out: ReviewTreeNode[] = []
  const walk = (ns: ReviewTreeNode[]) => {
    for (const n of ns) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Review state lives in a footer of the project description, so every review
 * action rewrites the description and nothing else. Each helper returns the new
 * description, or null when the action would not change it.
 */
function nextDescription(
  project: Pick<Project, 'description'>,
  mutator: (m: ReviewMetadata) => ReviewMetadata,
): string | null {
  const next = upsertFooter(project.description, mutator(parseReviewFooter(project.description)))
  return next === project.description ? null : next
}

export function reviewedDescription(project: Pick<Project, 'description'>, today = todayLocalIsoDate()): string | null {
  return nextDescription(project, (m) => ({ ...m, state: 'reviewed', lastReviewedAt: today }))
}

export function cadenceDescription(project: Pick<Project, 'description'>, cadenceDays: number | null): string | null {
  return nextDescription(project, (m) => ({
    ...m,
    cadenceDaysOverride: cadenceDays && cadenceDays > 0 ? cadenceDays : null,
  }))
}

export function excludeDescription(project: Pick<Project, 'description'>, excluded: boolean): string | null {
  return nextDescription(project, (m) => {
    if (excluded) return { state: 'excluded', lastReviewedAt: null, cadenceDaysOverride: null }
    return { ...m, state: 'never', lastReviewedAt: null }
  })
}

export interface ReviewMutateOptions {
  onSuccess?: () => void
  onError?: (error: Error) => void
}

/**
 * Save a new description for a review action. The request carries `{ description }`
 * only: the project passed in may be a tree node (it has `children`, which the server
 * rejects with a 422) or a stale copy of fields this action never touches.
 * Failures are shown to the user instead of vanishing.
 */
function useSaveReviewDescription(failureLabel: string) {
  const update = useUpdateProject()
  const save = (
    project: Project,
    description: string | null,
    options?: ReviewMutateOptions,
    // Undo restores a description that differs from the cached one on purpose, so
    // it is sent without diffing against the cache.
    diffAgainstCache = true,
  ) => {
    if (description === null) {
      // Nothing to write: the project already has this review state.
      options?.onSuccess?.()
      return
    }
    update.mutate(
      { id: project.id, changes: { description }, original: diffAgainstCache ? project : undefined },
      {
        onSuccess: () => options?.onSuccess?.(),
        onError: (error) => {
          useReviewNoticeStore.getState().showError(`${failureLabel}: ${error.message}`)
          options?.onError?.(error)
        },
      },
    )
  }
  return { update, save }
}

export function useMarkReviewed() {
  const { update, save } = useSaveReviewDescription('Could not mark the project as reviewed')
  const mutate = (vars: { project: Project }, options?: ReviewMutateOptions) =>
    save(vars.project, reviewedDescription(vars.project), options)
  return { ...update, mutate }
}

export function useSetReviewCadence() {
  const { update, save } = useSaveReviewDescription('Could not save the review cadence')
  const mutate = (vars: { project: Project; cadenceDays: number | null }, options?: ReviewMutateOptions) =>
    save(vars.project, cadenceDescription(vars.project, vars.cadenceDays), options)
  return { ...update, mutate }
}

export function useExcludeFromReview() {
  const { update, save } = useSaveReviewDescription('Could not update the review settings')
  const mutate = (vars: { project: Project; excluded: boolean }, options?: ReviewMutateOptions) =>
    save(vars.project, excludeDescription(vars.project, vars.excluded), options)
  return { ...update, mutate }
}

/** Put a project's previous description back (undo). Sends `{ description }` only. */
export function useRestoreReviewDescription() {
  const { update, save } = useSaveReviewDescription('Could not undo the review')
  const mutate = (vars: { project: Project }, options?: ReviewMutateOptions) =>
    save(vars.project, vars.project.description, options, false)
  return { ...update, mutate }
}
