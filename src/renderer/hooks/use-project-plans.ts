import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { toast } from '@/stores/toast-store'
import type { Project, Task, TaskQueryParams } from '@/lib/vikunja-types'
import { usePro } from './use-pro'
import { useSyncedPrefs, writeSyncedPrefs, SYNCED_PREFS_QUERY_KEY } from './use-synced-prefs'
import { useProjectTasks } from './use-project-tasks'
import { usePromiseWorld, type PromiseWorld } from './use-promise-world'
import { ledgerInArea } from './use-groups'
import { useCreateProject, useUpdateTask } from './use-task-mutations'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'
import { asPlanTask, sortPlanTasks } from '@/lib/pro/plan-display'
import { toLocalDate, type LocalDate } from '../../shared/due-dates'
import type { ProLedger } from '../../shared/pro/ledger'
import { projectPlanKey } from '../../shared/pro/prefs'
import {
  carryOver,
  closePlan,
  nextPlan,
  planValue,
  plansOf,
  planView,
  readPlan,
  type PlanTask,
  type PlanView,
  type ProjectPlan,
} from '../../shared/pro/project-plan'

export interface PlanEntry {
  project: number
  plan: ProjectPlan
}

export interface ProjectPlans {
  /** The promises layer is on: plans are shown. Off, every list is empty. */
  on: boolean
  /** Open plans first by end day, then closed ones, newest first (21.20). */
  plans: PlanEntry[]
  byProject: Map<number, ProjectPlan>
  /** The plans of a group, in the same order. */
  ofGroup: (labelId: number) => PlanEntry[]
  /** The plan that carries on from a project's plan, or null. */
  followOn: (projectId: number) => PlanEntry | null
}

const NO_PLANS: PlanEntry[] = []

/** The account's 90-day plans (cross-app semantics 21.20), from the synced preferences. */
export function useProjectPlans(): ProjectPlans {
  const on = usePro().layer('promises')
  const { snapshot } = useSyncedPrefs()
  const values = snapshot.values
  return useMemo(() => {
    const plans = on ? plansOf(values) : NO_PLANS
    return {
      on,
      plans,
      byProject: new Map(plans.map((entry) => [entry.project, entry.plan])),
      ofGroup: (labelId) => plans.filter((entry) => entry.plan.group === labelId),
      followOn: (projectId) => plans.find((entry) => entry.plan.from === projectId) ?? null,
    }
  }, [on, values])
}

/** What a plan's form edits; fields it does not show stay as they are. */
export interface PlanDraft {
  start: LocalDate
  end: LocalDate
  group: number | null
}

export type CarryOverOutcome =
  | { ok: true; project: number }
  | { ok: false; reason: 'offline' }
  | { ok: false; reason: 'create' }
  | { ok: false; reason: 'move'; moved: number; total: number; project: number; error: string }

/** The stored value of a plan's key right now (unknown fields and all), for Undo. */
function storedValue(queryClient: ReturnType<typeof useQueryClient>, projectId: number): unknown {
  const snapshot = queryClient.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)
  return snapshot?.values[projectPlanKey(projectId)] ?? null
}

/** Saving, removing and closing plans. Every write is one synced change. */
export function usePlanActions() {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const createProject = useCreateProject({ silent: true })
  const updateTask = useUpdateTask({ silent: true })

  /** Creates or edits a plan. False when main refused it (writeSyncedPrefs said why). */
  const save = useCallback(async (projectId: number, draft: PlanDraft): Promise<boolean> => {
    const before = readPlan(storedValue(queryClient, projectId))
    const plan: ProjectPlan = before
      ? { ...before, start: draft.start, end: draft.end, group: draft.group }
      : { start: draft.start, end: draft.end, group: draft.group, closed: null, from: null }
    return writeSyncedPrefs(queryClient, { [projectPlanKey(projectId)]: planValue(plan) })
  }, [queryClient])

  /** Takes the plan off the project (the project and its tasks stay), with Undo. */
  const remove = useCallback(async (projectId: number): Promise<boolean> => {
    const before = storedValue(queryClient, projectId)
    const ok = await writeSyncedPrefs(queryClient, { [projectPlanKey(projectId)]: null })
    if (ok) {
      toast.success(t('pro.plan.removed'), {
        action: { label: t('pro.plan.undo'), onAction: () => void writeSyncedPrefs(queryClient, { [projectPlanKey(projectId)]: before }) },
      })
    }
    return ok
  }, [queryClient, t])

  /** Closes the plan today, with Undo. */
  const close = useCallback(async (projectId: number, plan: ProjectPlan): Promise<boolean> => {
    const before = storedValue(queryClient, projectId)
    const ok = await writeSyncedPrefs(queryClient, { [projectPlanKey(projectId)]: planValue(closePlan(plan, toLocalDate(new Date()))) })
    if (ok) {
      toast.success(t('pro.plan.closed'), {
        action: { label: t('pro.plan.undo'), onAction: () => void writeSyncedPrefs(queryClient, { [projectPlanKey(projectId)]: before }) },
      })
    }
    return ok
  }, [queryClient, t])

  /**
   * Closes the plan and carries its open work into a new project next to it (21.20): the project
   * first (it needs the server), then the items, then their milestones, one at a time, then the
   * new plan and the old one's `closed` in one change. A move that fails stops it, and the old plan
   * stays open.
   */
  const closeWithCarryOver = useCallback(async (input: {
    project: Pick<Project, 'id' | 'parent_project_id'>
    plan: ProjectPlan
    tasks: readonly (Task & PlanTask)[]
    name: string
  }): Promise<CarryOverOutcome> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' }
    const created = await createProject.mutateAsync({
      title: input.name.trim(),
      ...(input.project.parent_project_id > 0 ? { parent_project_id: input.project.parent_project_id } : {}),
    }).catch(() => null)
    if (!created || typeof created.id !== 'number' || created.id <= 0) return { ok: false, reason: 'create' }
    const { items, milestones } = carryOver(input.tasks)
    const byId = new Map(input.tasks.map((task) => [task.id, task]))
    const ids = [...items, ...milestones]
    let moved = 0
    for (const id of ids) {
      const task = byId.get(id)
      if (!task) continue
      try {
        await updateTask.mutateAsync({ id, changes: { project_id: created.id }, original: task })
        moved++
      } catch (error) {
        return { ok: false, reason: 'move', moved, total: ids.length, project: created.id, error: error instanceof Error ? error.message : '' }
      }
    }
    const today = toLocalDate(new Date())
    const ok = await writeSyncedPrefs(queryClient, {
      [projectPlanKey(created.id)]: planValue(nextPlan(input.plan, input.project.id, today)),
      [projectPlanKey(input.project.id)]: planValue(closePlan(input.plan, today)),
    })
    if (!ok) return { ok: false, reason: 'move', moved, total: ids.length, project: created.id, error: '' }
    return { ok: true, project: created.id }
  }, [createProject, updateTask, queryClient])

  return { save, remove, close, closeWithCarryOver }
}

export interface PlanData {
  isLoading: boolean
  tasks: Array<Task & PlanTask>
  byId: Map<number, Task & PlanTask>
  ledger: ProLedger
  world: PromiseWorld
  view: PlanView | null
  today: LocalDate
}

/** Everything a plan's view reads: the project's tasks, the ledger in Pro's area and the counts. */
export function usePlanData(projectId: number, plan: ProjectPlan | null | undefined): PlanData {
  const world = usePromiseWorld()
  const enabled = world.on && !!plan && projectId > 0
  const displayed = useProjectTasks(enabled ? projectId : undefined)
  const params = useMemo<TaskQueryParams>(() => ({ filter: `project_id = ${projectId}`, keep_nested_subtasks: true }), [projectId])
  // The same key as useTasks, so every task change refreshes it; without the focus filter.
  const all = useQuery({
    queryKey: ['tasks', params],
    queryFn: async () => {
      const result = await api.fetchTasks(params)
      if (!result.success) throw new Error(result.error)
      return (result.data ?? []) as Task[]
    },
    enabled,
  })
  const today = toLocalDate(new Date())
  return useMemo(() => {
    const tasks = sortPlanTasks(all.data ?? [], displayed.data ?? []).map(asPlanTask)
    const ledger = ledgerInArea(world, tasks)
    return {
      isLoading: enabled && (all.isLoading || displayed.isLoading || world.isLoading),
      tasks,
      byId: new Map(tasks.map((task) => [task.id, task])),
      ledger,
      world,
      view: plan ? planView({ plan, tasks, ledger, today }) : null,
      today,
    }
  }, [all.data, all.isLoading, displayed.data, displayed.isLoading, world, plan, today, enabled])
}
