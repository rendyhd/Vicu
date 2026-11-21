/**
 * Work and Personal (docs/cross-app-semantics-v1.md section 22): which tasks and projects are work,
 * and what a device in Work or Personal mode shows. What work is syncs (`work.label`,
 * `work.project.<id>`); the mode is per device. Android has the same rules; both run the `workMode`
 * vectors of `test-fixtures/cross-app-semantics-v1.json`.
 *
 * Import-free on purpose, so every tsconfig can include it.
 */

// --- Keys and values (section 22.1) -----------------------------------------------------------

/** The synced key of the work label. */
export const WORK_LABEL_KEY = 'work.label'

const WORK_PROJECT_PREFIX = 'work.project.'

/** The synced key of a project's own entry. */
export function workProjectKey(projectId: number): string {
  return `${WORK_PROJECT_PREFIX}${projectId}`
}

/** The project id of a `work.project.<id>` key, or null for any other key. */
export function workProjectIdOfKey(key: string): number | null {
  if (!key.startsWith(WORK_PROJECT_PREFIX)) return null
  const rest = key.slice(WORK_PROJECT_PREFIX.length)
  if (!/^[1-9][0-9]*$/.test(rest)) return null
  const id = Number(rest)
  return Number.isSafeInteger(id) ? id : null
}

/** The work label's id: a whole number above 0. Anything else is no label. */
export function readWorkLabel(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** A project's own entry: `true` (work), `false` (not work), anything else is no entry. */
export function readWorkProjectEntry(value: unknown): boolean | null {
  return value === true || value === false ? value : null
}

/** A value main may write under `work.label` or `work.project.<id>`. */
export function isWritableWorkValue(key: string, value: unknown): boolean {
  if (value === null) return key === WORK_LABEL_KEY || workProjectIdOfKey(key) !== null
  if (key === WORK_LABEL_KEY) return readWorkLabel(value) !== null
  return workProjectIdOfKey(key) !== null && readWorkProjectEntry(value) !== null
}

// --- Which projects are work (section 22.2) ---------------------------------------------------

export interface WorkProject {
  id: number
  parent_project_id?: number | null
}

/**
 * The projects that are work: a project's own entry decides, else the entry of its nearest
 * ancestor that has one, else it is not work. The walk ends at a parent that is not given and at a
 * loop. The Inbox is never work and its entry is not used, also not by its subprojects.
 */
export function workProjectIds(
  projects: Iterable<WorkProject>,
  entryOf: (projectId: number) => unknown,
  inboxProjectId: number | null | undefined,
): Set<number> {
  const byId = new Map<number, WorkProject>()
  for (const project of projects) byId.set(project.id, project)
  const work = new Set<number>()
  for (const project of byId.values()) {
    let current: WorkProject | undefined = project
    const seen = new Set<number>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      if (current.id !== inboxProjectId) {
        const entry = readWorkProjectEntry(entryOf(current.id))
        if (entry !== null) {
          if (entry) work.add(project.id)
          break
        }
      }
      const parent: number | null | undefined = current.parent_project_id
      current = parent && parent > 0 ? byId.get(parent) : undefined
    }
  }
  if (typeof inboxProjectId === 'number') work.delete(inboxProjectId)
  return work
}

/**
 * The entry to write when the person marks a project (section 22.7): none when the project would
 * be what they want without one, else what they want.
 */
export function workEntryToWrite(want: boolean, parentIsWork: boolean): boolean | null {
  return want === parentIsWork ? null : want
}

// --- Which tasks are work (section 22.3) ------------------------------------------------------

/** What work is on this account, read once from the synced values and the project list. */
export interface WorkScope {
  /** The work label, or null when none is set or the label it names is gone. */
  label: number | null
  projects: ReadonlySet<number>
}

export interface WorkTask {
  project_id?: number | null
  labels?: ReadonlyArray<{ id: number }> | null
}

/** A task is work when its project is work or it carries the work label. */
export function isWorkTask(task: WorkTask, scope: WorkScope): boolean {
  if (typeof task.project_id === 'number' && scope.projects.has(task.project_id)) return true
  const label = scope.label
  return label !== null && Array.isArray(task.labels) && task.labels.some((entry) => entry?.id === label)
}

// --- The mode (section 22.4) ------------------------------------------------------------------

export const WORK_MODES = ['all', 'work', 'personal'] as const
export type WorkMode = (typeof WORK_MODES)[number]

/** A stored mode; anything else is `all`. */
export function parseWorkMode(value: unknown): WorkMode {
  return value === 'work' || value === 'personal' ? value : 'all'
}

/** The device settings the mode reads (desktop `AppConfig`, mobile its behaviour settings). */
export interface WorkModeSwitches {
  work_mode_enabled?: boolean
  work_mode?: string
  pro_only_in_work?: boolean
  standalone_mode?: boolean
}

/** The mode in effect: `all` while the feature is off or the device is in standalone mode. */
export function effectiveWorkMode(config: WorkModeSwitches | null | undefined): WorkMode {
  if (!config || config.work_mode_enabled !== true || config.standalone_mode === true) return 'all'
  return parseWorkMode(config.work_mode)
}

/** Whether the mode lists a task: everything in All, work in Work, the rest in Personal. */
export function passesWorkMode(task: WorkTask, scope: WorkScope, mode: WorkMode): boolean {
  if (mode === 'all') return true
  return isWorkTask(task, scope) === (mode === 'work')
}

/**
 * The tasks of a list the mode shows, in the list's order. `parentOf` names the task a row is
 * nested under in this list (null for a row of its own): a row nested under a shown row is shown
 * with it, whatever it is itself.
 */
export function shownInWorkMode<T extends WorkTask & { id: number }>(
  tasks: readonly T[],
  scope: WorkScope,
  mode: WorkMode,
  parentOf?: (task: T) => number | null | undefined,
): T[] {
  if (mode === 'all') return [...tasks]
  const byId = new Map<number, T>()
  for (const task of tasks) byId.set(task.id, task)
  const decided = new Map<number, boolean>()
  const shown = (task: T, trail: Set<number>): boolean => {
    const known = decided.get(task.id)
    if (known !== undefined) return known
    let result = passesWorkMode(task, scope, mode)
    if (!result && parentOf && !trail.has(task.id)) {
      trail.add(task.id)
      const parentId = parentOf(task)
      const parent = typeof parentId === 'number' ? byId.get(parentId) : undefined
      result = parent !== undefined && shown(parent, trail)
    }
    decided.set(task.id, result)
    return result
  }
  return tasks.filter((task) => shown(task, new Set()))
}

// --- The project list (section 22.5) ----------------------------------------------------------

/**
 * The projects the mode lists: in Work the work projects, in Personal the others, and in both a
 * project above one that is listed, so the tree stays whole. The Inbox is always listed.
 */
export function projectsShownInMode(
  projects: Iterable<WorkProject>,
  work: ReadonlySet<number>,
  mode: WorkMode,
  inboxProjectId: number | null | undefined,
): Set<number> {
  const byId = new Map<number, WorkProject>()
  for (const project of projects) byId.set(project.id, project)
  const shown = new Set<number>()
  for (const project of byId.values()) {
    const own = mode === 'all' || project.id === inboxProjectId || work.has(project.id) === (mode === 'work')
    if (!own) continue
    let current: WorkProject | undefined = project
    while (current && !shown.has(current.id)) {
      shown.add(current.id)
      const parent: number | null | undefined = current.parent_project_id
      current = parent && parent > 0 ? byId.get(parent) : undefined
    }
  }
  return shown
}

// --- New tasks (section 22.6) -----------------------------------------------------------------

/**
 * The label a task made in this mode gets on top of its own: the work label, in Work mode, for a
 * task that would not be work without it. Null when nothing is added.
 */
export function workLabelForNewTask(task: WorkTask, scope: WorkScope, mode: WorkMode): number | null {
  if (mode !== 'work' || scope.label === null) return null
  return isWorkTask(task, scope) ? null : scope.label
}

/** True when a task made in Work mode stays Personal, because there is no work label to give it. */
export function newTaskStaysPersonal(task: WorkTask, scope: WorkScope, mode: WorkMode): boolean {
  return mode === 'work' && scope.label === null && !isWorkTask(task, scope)
}

// --- Pro (section 22.8) -----------------------------------------------------------------------

/**
 * Whether the mode lets Pro show: with "Pro only in Work" on, a device in Personal mode acts as a
 * device with Pro off (section 21.1). Pro's own switch is asked separately.
 */
export function proAllowedInWorkMode(config: WorkModeSwitches | null | undefined): boolean {
  return !(config?.pro_only_in_work === true && effectiveWorkMode(config) === 'personal')
}

/** The value of `pro.area` that means "the work projects". */
export const PRO_AREA_WORK = 'work'

export function isWorkProArea(value: unknown): boolean {
  return value === PRO_AREA_WORK
}

// --- Server filters (section 22.9) ------------------------------------------------------------

/**
 * A filter clause that narrows a server listing to a superset of what the mode shows, or null when
 * the listing cannot be narrowed. `empty` means the mode shows nothing, so nothing needs asking.
 * The device still applies the rule to the answer.
 */
export function workModeClause(scope: WorkScope, mode: WorkMode): { clause: string | null; empty: boolean } {
  if (mode === 'all') return { clause: null, empty: false }
  const ids = [...scope.projects].sort((a, b) => a - b)
  if (mode === 'personal') {
    return { clause: ids.length > 0 ? `project not in ${ids.join(', ')}` : null, empty: false }
  }
  const parts: string[] = []
  if (ids.length > 0) parts.push(`project in ${ids.join(', ')}`)
  if (scope.label !== null) parts.push(`labels = ${scope.label}`)
  if (parts.length === 0) return { clause: null, empty: true }
  return { clause: parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`, empty: false }
}
