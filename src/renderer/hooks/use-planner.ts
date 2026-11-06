import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AppConfig, Task, TaskQueryParams } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'
import { planRangeFilter } from '@/lib/planner-timeline'
import { useDayKey } from '@/stores/day-store'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from './use-app-config'
import { useProjects } from './use-projects'
import { useRoutines } from './use-routines'
import { occurrencesForDate } from '@/lib/routines'
import { isRoutinesEnabled } from '@/lib/vikunja-types'
import { useSetSyncedPreference, useSyncedPrefs } from './use-synced-prefs'
import { useTasks } from './use-tasks'
import { toLocalDate, type LocalDate } from '../../shared/due-dates'
import { PLANNER_DEFAULT_LENGTH_KEY, PLANNER_HOURS_KEY } from '../../shared/synced-prefs'
import {
  DEFAULT_LENGTH_MINUTES,
  DEFAULT_PLANNER_HOURS,
  readDefaultLength,
  readPlannerHours,
  type BlockChanges,
  type PlannerHours,
} from '../../shared/time-blocks'

/** The two synced settings (contract 11.3): `null` is the default on every device. */
export function usePlannerPrefs() {
  const { snapshot } = useSyncedPrefs()
  const set = useSetSyncedPreference()
  const defaultLength = readDefaultLength(snapshot.values[PLANNER_DEFAULT_LENGTH_KEY])
  const hours = readPlannerHours(snapshot.values[PLANNER_HOURS_KEY])
  return {
    defaultLength,
    hours,
    setDefaultLength: (minutes: number) =>
      set.mutate({ key: PLANNER_DEFAULT_LENGTH_KEY, value: minutes === DEFAULT_LENGTH_MINUTES ? null : minutes }),
    setHours: (next: PlannerHours) =>
      set.mutate({
        key: PLANNER_HOURS_KEY,
        value: next[0] === DEFAULT_PLANNER_HOURS[0] && next[1] === DEFAULT_PLANNER_HOURS[1] ? null : next,
      }),
  }
}

/** Device settings, shown at once and saved as a patch. */
export function useSavePlannerConfig() {
  const qc = useQueryClient()
  return useCallback(
    (patch: Partial<AppConfig>) => {
      const current = qc.getQueryData<AppConfig>(APP_CONFIG_QUERY_KEY)
      if (current) qc.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, ...patch })
      // The evening nudge is a timer in main; it reads the saved config.
      const saved = api.saveConfigPatch(patch)
      if ('planner_nudge' in patch || 'planner_enabled' in patch) void Promise.resolve(saved).then(() => api.rescheduleNotifications())
    },
    [qc],
  )
}

/**
 * One request for the days on screen: a block starting in them, an open task due in them, and
 * overdue tasks when today is shown. Subtasks stay as rows of their own here, because a subtask can
 * have a block of its own; the left panel leaves out the ones nested under a listed parent.
 */
export function usePlanRange(days: readonly LocalDate[]) {
  const dayKey = useDayKey()
  const today = toLocalDate(new Date())
  const key = days.join()
  const params = useMemo<TaskQueryParams>(
    () => ({
      filter: planRangeFilter(days, today),
      sort_by: 'due_date',
      order_by: 'asc',
      per_page: 1000,
      keep_nested_subtasks: true,
    }),
    [key, today, dayKey],
  )
  const query = useTasks(params)
  const { data: projects } = useProjects()
  const tasks = useMemo(() => {
    if (!projects) return []
    const active = new Set(projects.flat.map((project) => project.id))
    return query.data.filter((task) => active.has(task.project_id))
  }, [query.data, projects])
  return { tasks, isLoading: query.isLoading, isFetching: query.isFetching }
}

export interface PlanRoutine {
  key: string
  day: LocalDate
  minute: number
  name: string
  done: boolean
}

/** Routines on the timeline: small pills at their times, never busy (contract 16.6). */
export function usePlanRoutines(days: readonly LocalDate[]): PlanRoutine[] {
  const { data: config } = useAppConfig()
  const on = isRoutinesEnabled(config) && config?.planner_show_routines !== false
  const routines = useRoutines({ enabled: on })
  const today = toLocalDate(new Date())
  const key = days.join()
  return useMemo(() => {
    if (!on) return []
    return days.flatMap((day) =>
      routines.active.flatMap((carrier) =>
        occurrencesForDate(carrier, day, today).map((occurrence) => ({
          key: `${occurrence.key}:${day}`,
          day,
          minute: occurrence.slot.reminderMinutes,
          name: carrier.payload.definition.name,
          done: occurrence.status === 'COMPLETED',
        })),
      ),
    )
  }, [on, key, routines.carriers, today])
}

/** A block change as the mutation and the cache want it: the null date where a date goes away. */
export function toTaskChanges(changes: BlockChanges): Partial<Task> {
  const out: Partial<Task> = {}
  if (changes.start_date !== undefined) out.start_date = changes.start_date ?? NULL_DATE
  if (changes.end_date !== undefined) out.end_date = changes.end_date ?? NULL_DATE
  if (changes.due_date !== undefined) out.due_date = changes.due_date ?? NULL_DATE
  if (changes.reminders !== undefined) out.reminders = changes.reminders as Task['reminders']
  return out
}
