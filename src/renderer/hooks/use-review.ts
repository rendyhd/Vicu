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
import type { Project, AppConfig, UpdateProjectPayload } from '@/lib/vikunja-types'

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

function applyMetaUpdate(project: Project, mutator: (m: ReviewMetadata) => ReviewMetadata): Project {
  const currentMeta = parseReviewFooter(project.description)
  const nextMeta = mutator(currentMeta)
  const newDescription = upsertFooter(project.description, nextMeta)
  if (newDescription === project.description) return project
  return { ...project, description: newDescription }
}

// Project is a structural superset of UpdateProjectPayload, so passing the
// full Project here keeps Vikunja's Go zero-value safety without a cast.
function projectToPayload(p: Project): UpdateProjectPayload {
  return p as unknown as UpdateProjectPayload
}

export function useMarkReviewed() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project }) => {
    const next = applyMetaUpdate(vars.project, (m) => ({
      ...m,
      state: 'reviewed',
      lastReviewedAt: todayLocalIsoDate(),
    }))
    if (next === vars.project) return
    update.mutate({ id: vars.project.id, project: projectToPayload(next) })
  }
  return { ...update, mutate }
}

export function useSetReviewCadence() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project; cadenceDays: number | null }) => {
    const next = applyMetaUpdate(vars.project, (m) => ({
      ...m,
      cadenceDaysOverride: vars.cadenceDays && vars.cadenceDays > 0 ? vars.cadenceDays : null,
    }))
    if (next === vars.project) return
    update.mutate({ id: vars.project.id, project: projectToPayload(next) })
  }
  return { ...update, mutate }
}

export function useExcludeFromReview() {
  const update = useUpdateProject()
  const mutate = (vars: { project: Project; excluded: boolean }) => {
    const next = applyMetaUpdate(vars.project, (m) => {
      if (vars.excluded) {
        return { state: 'excluded', lastReviewedAt: null, cadenceDaysOverride: null }
      }
      return { ...m, state: 'never', lastReviewedAt: null }
    })
    if (next === vars.project) return
    update.mutate({ id: vars.project.id, project: projectToPayload(next) })
  }
  return { ...update, mutate }
}
