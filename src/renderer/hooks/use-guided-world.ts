import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { startOfLocalDayIso, toLocalDate } from '@/lib/due-dates'
import { useDayKey } from '@/stores/day-store'
import { effectivePermission } from '../../shared/collaboration'
import { GuidedWorld } from '../../shared/guided'
import { WEEKLY_REVIEW_LAST_KEY, readWeeklyReviewLast } from '../../shared/synced-prefs'
import type { Task } from '@/lib/vikunja-types'
import { useAppConfig } from './use-app-config'
import { useProjectAccessMap } from './use-project-access'
import { useProjectTasks } from './use-project-tasks'
import { useProjects } from './use-projects'
import { useSyncedPrefs } from './use-synced-prefs'
import { useTasks } from './use-tasks'
import { useWorkMode } from './use-work-mode'

// What the guided sessions read (docs/cross-app-semantics-v1.md section 14): every open task with
// subtasks kept (a queue holds tasks, not rows), the tasks done in the last 7 local days, the
// projects, the Inbox, the review settings and the task orders. The Inbox's tasks carry the
// positions of its list view, as the Inbox shows them.

const OPEN_TASKS = { filter: 'done = false', keep_nested_subtasks: true } as const

export const GUIDED_OPEN_TASKS_KEY = ['tasks', OPEN_TASKS] as const

/** Positions of a project's list view by task id (the order the project and the Inbox show). */
function viewPositions(tasks: readonly Task[]): Map<number, number> {
  return new Map(tasks.map((task) => [task.id, task.position]))
}

export interface GuidedData {
  world: GuidedWorld<Task> | null
  isLoading: boolean
  /** The open task with this id as the caches hold it now, or undefined when done or gone. */
  openTask: (id: number) => Task | undefined
  /** `weekly_review.last`, read (null: never, or unreadable). */
  weeklyReviewLast: string | null
}

/**
 * The guided world. `projectId` adds a project's list-view positions and its latest done task (a
 * review page's health reads when it was last done).
 */
export function useGuidedWorld(projectId?: number): GuidedData {
  const dayKey = useDayKey()
  const today = useMemo(() => toLocalDate(new Date()), [dayKey])
  const open = useTasks(OPEN_TASKS, true, true)
  const doneParams = useMemo(
    () => ({ filter: `done = true && done_at >= '${startOfLocalDayIso(-6)}'`, keep_nested_subtasks: true, sort_by: 'done_at', order_by: 'desc' }),
    [dayKey],
  )
  const recentlyDone = useTasks(doneParams, true, true)
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: config, isLoading: configLoading } = useAppConfig()
  const { snapshot } = useSyncedPrefs()
  const access = useProjectAccessMap()
  const inboxId = config?.inbox_project_id || 0
  // Work and Personal (22.4): the review queue lists the projects the mode lists.
  const reviewScope = useWorkMode().shownProjects
  const inboxView = useProjectTasks(inboxId || undefined, true, true)
  const projectView = useProjectTasks(projectId && projectId !== inboxId ? projectId : undefined, true, true)
  const lastDone = useQuery({
    queryKey: ['tasks', { filter: `done = true && project_id = ${projectId ?? 0}`, sort_by: 'done_at', order_by: 'desc', page: 1, per_page: 1 }],
    queryFn: async () => {
      const result = await api.fetchTasks({ filter: `done = true && project_id = ${projectId}`, sort_by: 'done_at', order_by: 'desc', page: 1, per_page: 1, keep_nested_subtasks: true })
      if (!result.success) throw new Error(result.error)
      return result.data ?? []
    },
    enabled: !!projectId,
  })

  const world = useMemo(() => {
    if (!open.data || !projects || !config) return null
    const positions = new Map([...viewPositions(inboxView.data ?? []), ...viewPositions(projectView.data ?? [])])
    const byId = new Map<number, Task>()
    for (const task of [...(recentlyDone.data ?? []), ...(lastDone.data ?? []), ...open.data]) {
      const position = positions.get(task.id)
      byId.set(task.id, position === undefined ? task : { ...task, position })
    }
    return new GuidedWorld<Task>({
      tasks: [...byId.values()],
      projects: projects.all,
      inboxId,
      today,
      review: {
        enabled: config.review?.enabled === true,
        defaultCadence: config.review?.default_cadence_days ?? 14,
        excludeInbox: config.review?.exclude_inbox ?? false,
      },
      orderValues: snapshot.values,
      reviewScope,
      permission: (project) => access.get(project.id)?.permission ?? effectivePermission(project.max_permission, false),
    })
  }, [open.data, recentlyDone.data, lastDone.data, projects, config, inboxId, today, snapshot.values, reviewScope, access, inboxView.data, projectView.data])

  const openTask = useMemo(() => {
    const byId = new Map((open.data ?? []).filter((task) => !task.done).map((task) => [task.id, task]))
    return (id: number) => byId.get(id)
  }, [open.data])

  return {
    world,
    isLoading: open.isLoading || projectsLoading || configLoading || (!!inboxId && inboxView.isLoading),
    openTask,
    weeklyReviewLast: readWeeklyReviewLast(snapshot.values[WEEKLY_REVIEW_LAST_KEY]),
  }
}
