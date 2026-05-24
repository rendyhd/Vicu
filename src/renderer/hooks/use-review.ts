import { useMemo } from 'react'
import { useProjects } from './use-projects'
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
