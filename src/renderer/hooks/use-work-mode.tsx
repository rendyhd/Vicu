import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AppConfig } from '@/lib/vikunja-types'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from './use-app-config'
import { useLabels } from './use-labels'
import { useProjects } from './use-projects'
import { useSyncedPrefs } from './use-synced-prefs'
import {
  WORK_LABEL_KEY,
  effectiveWorkMode,
  hiddenWorkLabel,
  isWorkTask,
  newTaskStaysPersonal,
  passesWorkMode,
  projectsShownInMode,
  readWorkLabel,
  shownInWorkMode,
  workLabelForNewTask,
  workProjectIds,
  workProjectKey,
  type WorkMode,
  type WorkScope,
  type WorkTask,
} from '../../shared/work-scope'

/**
 * Work and Personal (cross-app semantics section 22) for every list of this window. Built once in
 * AppShell from the synced preferences, the projects and the labels. What work is (`scope`) is
 * always known, because Pro's area may name it on a device that has the feature off; the mode in
 * effect is `all` while the feature is off, and then `filter` hands every list back as it is, with
 * one identity, so nothing recomputes.
 */
export interface WorkModeState {
  /** The feature is on on this device (and the device is not in standalone mode). */
  enabled: boolean
  /** The mode in effect: `all` while the feature is off. */
  mode: WorkMode
  /** The stored mode, also while the feature is off. */
  storedMode: WorkMode
  /** Whether the switch offers All as a third position after Personal and Work. */
  showAll: boolean
  /** Whether task rows show the work label chip while in Work mode (default false: hidden). */
  showWorkLabel: boolean
  /** The label id hidden on task rows in Work mode, or null when nothing is hidden. */
  hiddenLabelId: number | null
  scope: WorkScope
  isWork: (task: WorkTask) => boolean
  /** Whether the mode lists this task (true for every task in All). */
  passes: (task: WorkTask) => boolean
  /**
   * The tasks the mode shows, in order. `parentOf` names the row a task is nested under in this
   * list: a row under a shown row is shown with it (section 22.4). The same array in All.
   */
  filter: <T extends WorkTask & { id: number }>(tasks: T[], parentOf?: (task: T) => number | null | undefined) => T[]
  /** The projects the project list holds (section 22.5), or null for all of them. */
  shownProjects: ReadonlySet<number> | null
  isWorkProject: (projectId: number) => boolean
  /** The label a task made now gets on top of its own (section 22.6), or null. */
  labelForNewTask: (task: WorkTask) => number | null
  /** True when a task made now stays Personal because no work label is set. */
  staysPersonal: (task: WorkTask) => boolean
}

const NO_SCOPE: WorkScope = { label: null, projects: new Set<number>() }

const OFF: WorkModeState = {
  enabled: false,
  mode: 'all',
  storedMode: 'all',
  showAll: false,
  showWorkLabel: false,
  hiddenLabelId: null,
  scope: NO_SCOPE,
  isWork: () => false,
  passes: () => true,
  filter: (tasks) => tasks,
  shownProjects: null,
  isWorkProject: () => false,
  labelForNewTask: () => null,
  staysPersonal: () => false,
}

const WorkModeContext = createContext<WorkModeState>(OFF)

export function WorkModeProvider({ children }: { children: ReactNode }) {
  const { data: config } = useAppConfig()
  const { data: projects } = useProjects()
  const { data: labels } = useLabels()
  const { snapshot } = useSyncedPrefs()
  const values = snapshot.values
  const inboxProjectId = config?.inbox_project_id ?? null

  // What work is. A work label whose label is gone is no work label; while the labels are still
  // loading the stored id is trusted, so the lists do not flash.
  const scope = useMemo<WorkScope>(() => {
    const stored = readWorkLabel(values[WORK_LABEL_KEY])
    const label = stored !== null && labels && !labels.some((entry) => entry.id === stored) ? null : stored
    const work = workProjectIds(projects?.all ?? [], (id) => values[workProjectKey(id)], inboxProjectId)
    return label === null && work.size === 0 ? NO_SCOPE : { label, projects: work }
  }, [values, labels, projects?.all, inboxProjectId])

  const enabled = config?.work_mode_enabled === true && config.standalone_mode !== true
  const mode = effectiveWorkMode(config ?? null)
  const storedMode = config?.work_mode ?? 'all'
  const showAll = config?.work_mode_show_all === true
  const showWorkLabel = config?.work_mode_show_work_label === true

  const value = useMemo<WorkModeState>(() => {
    const shownProjects = mode === 'all' ? null : projectsShownInMode(projects?.all ?? [], scope.projects, mode, inboxProjectId)
    return {
      enabled,
      mode,
      storedMode,
      showAll,
      showWorkLabel,
      hiddenLabelId: hiddenWorkLabel(scope, mode, showWorkLabel),
      scope,
      isWork: (task) => isWorkTask(task, scope),
      passes: (task) => passesWorkMode(task, scope, mode),
      filter: (tasks, parentOf) => (mode === 'all' ? tasks : shownInWorkMode(tasks, scope, mode, parentOf)),
      shownProjects,
      isWorkProject: (projectId) => scope.projects.has(projectId),
      labelForNewTask: (task) => workLabelForNewTask(task, scope, mode),
      staysPersonal: (task) => newTaskStaysPersonal(task, scope, mode),
    }
  }, [enabled, mode, storedMode, showAll, showWorkLabel, scope, projects?.all, inboxProjectId])

  return <WorkModeContext.Provider value={value}>{children}</WorkModeContext.Provider>
}

/** The Work and Personal state of this window. Outside the provider: the feature off. */
export function useWorkMode(): WorkModeState {
  return useContext(WorkModeContext)
}

/**
 * The mode's filter for a flat list, with a stable identity per mode and scope (like
 * `useParkedFilter`): put it in a memo's dependencies. In All it returns its argument.
 */
export function useWorkFilter(): <T extends WorkTask & { id: number }>(tasks: T[]) => T[] {
  const { filter } = useWorkMode()
  return useCallback(<T extends WorkTask & { id: number }>(tasks: T[]): T[] => filter(tasks), [filter])
}

/** The row a task is nested under in a list, for `filter`'s `parentOf` (a subtask under a shown parent stays). */
export function parentTaskId(task: { related_tasks?: { parenttask?: ReadonlyArray<{ id: number }> } | null }): number | undefined {
  return task.related_tasks?.parenttask?.[0]?.id
}

/** Saves the device settings of Work and Personal as a patch, shown at once. */
export function useSaveWorkModeConfig() {
  const queryClient = useQueryClient()
  return useCallback(
    (patch: Pick<Partial<AppConfig>, 'work_mode_enabled' | 'work_mode' | 'work_mode_show_all' | 'work_mode_show_work_label' | 'pro_only_in_work'>) => {
      const current = queryClient.getQueryData<AppConfig>(APP_CONFIG_QUERY_KEY)
      if (current) queryClient.setQueryData<AppConfig>(APP_CONFIG_QUERY_KEY, { ...current, ...patch })
      return api.saveConfigPatch(patch)
    },
    [queryClient],
  )
}

/** Changes the mode of this device. Writes nothing but that setting (section 22.4). */
export function useSetWorkMode(): (mode: WorkMode) => void {
  const save = useSaveWorkModeConfig()
  return useCallback((mode: WorkMode) => void save({ work_mode: mode }), [save])
}
