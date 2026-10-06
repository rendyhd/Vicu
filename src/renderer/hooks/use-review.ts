import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { isRetriableError } from '@/lib/error-classify'
import { useProjects } from './use-projects'
import type { ProjectTreeNode } from './use-projects'
import { useAppConfig } from './use-app-config'
import { updateProjectRequest } from './use-task-mutations'
import {
  parseReviewFooter,
  computeStatus,
  restoreFooter,
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
 * The description of a project as the server has it right now. A review save must apply its
 * footer change to this and not to the cached copy, or a description edited on another device
 * since the cache was filled would be overwritten (D-REV-2 / X-7 follow-up).
 *
 * Only a network failure (offline, DNS, timeout) falls back to the cached description: the PATCH
 * then fails or is the best the user can do. Any other failure (project deleted, no permission)
 * is an error and nothing is written.
 */
async function currentDescription(project: Pick<Project, 'id' | 'description'>): Promise<string> {
  const result = await api.fetchProject(project.id)
  if (result.success) return result.data.description ?? ''
  if (isRetriableError(result.error)) {
    console.warn('[review] could not reload the project description, using the cached one:', result.error)
    return project.description ?? ''
  }
  throw new Error(result.error)
}

/**
 * Save a review change. The request carries `{ description }` only: the project passed in may be
 * a tree node (it has `children`, which the server rejects with a 422) or a stale copy of fields
 * this action never touches. `compute` receives the current server description and returns the
 * new one, or null when nothing needs to change; nothing is written in that case.
 */
export async function saveReviewDescription(
  project: Project,
  compute: (current: Pick<Project, 'description'>) => string | null,
): Promise<Project | null> {
  const current = await currentDescription(project)
  const next = compute({ description: current })
  if (next === null || next === current) return null
  return updateProjectRequest({
    id: project.id,
    changes: { description: next },
    original: { ...project, description: current },
  })
}

export const markReviewedRequest = (project: Project, today = todayLocalIsoDate()) =>
  saveReviewDescription(project, (current) => reviewedDescription(current, today))

export const setReviewCadenceRequest = (project: Project, cadenceDays: number | null) =>
  saveReviewDescription(project, (current) => cadenceDescription(current, cadenceDays))

export const excludeFromReviewRequest = (project: Project, excluded: boolean) =>
  saveReviewDescription(project, (current) => excludeDescription(current, excluded))

/**
 * Undo: put the review footer `previous` had back onto the current description. Only the footer
 * is restored, so a description edit made since then survives the undo.
 */
export const restoreReviewRequest = (previous: Project) =>
  saveReviewDescription(previous, (current) => restoreFooter(current.description, previous.description))

/** Review mutations: shared error reporting, and a refresh of the project list when settled. */
function useReviewMutation<V extends { project: Project }>(
  failureLabel: string,
  request: (vars: V) => Promise<Project | null>,
) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: request,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const mutate = (vars: V, options?: ReviewMutateOptions) =>
    update.mutate(vars, {
      onSuccess: () => options?.onSuccess?.(),
      onError: (error) => {
        useReviewNoticeStore.getState().showError(`${failureLabel}: ${error.message}`)
        options?.onError?.(error)
      },
    })
  return { ...update, mutate }
}

export function useMarkReviewed() {
  return useReviewMutation(
    'Could not mark the project as reviewed',
    (vars: { project: Project }) => markReviewedRequest(vars.project),
  )
}

export function useSetReviewCadence() {
  return useReviewMutation(
    'Could not save the review cadence',
    (vars: { project: Project; cadenceDays: number | null }) => setReviewCadenceRequest(vars.project, vars.cadenceDays),
  )
}

export function useExcludeFromReview() {
  return useReviewMutation(
    'Could not update the review settings',
    (vars: { project: Project; excluded: boolean }) => excludeFromReviewRequest(vars.project, vars.excluded),
  )
}

/** Put a project's previous review footer back (undo). Sends `{ description }` only. */
export function useRestoreReviewDescription() {
  return useReviewMutation(
    'Could not undo the review',
    (vars: { project: Project }) => restoreReviewRequest(vars.project),
  )
}
