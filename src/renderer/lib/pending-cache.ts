import type { QueryClient } from '@tanstack/react-query'
import { NULL_DATE } from './constants'
import { sortProjectTasks } from './task-sort'
import type { SectionTaskCacheEntry } from './section-task-cache'
import type { Label, Task } from './vikunja-types'

// Query-cache helpers for changes that went into the offline queue: a task that only exists as a
// pending create lives in the cache under its negative temp id, and when the replay creates it
// the temp id is swapped for the real one.

/** A task created offline has a negative temp id until its create replays. */
export function isTempTaskId(id: number): boolean {
  return id < 0
}

/** Build the task the lists show for a pending create. */
export function pendingTaskFromCreate(
  tempId: number,
  projectId: number,
  fields: Record<string, unknown>,
  options: { now?: string; labels?: Label[]; done?: boolean } = {},
): Task {
  const now = options.now ?? new Date().toISOString()
  const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
  const num = (value: unknown) => (typeof value === 'number' ? value : 0)
  return {
    id: tempId,
    title: str(fields.title),
    description: str(fields.description),
    done: options.done === true,
    done_at: options.done === true ? now : NULL_DATE,
    due_date: str(fields.due_date, NULL_DATE) || NULL_DATE,
    start_date: str(fields.start_date, NULL_DATE) || NULL_DATE,
    end_date: str(fields.end_date, NULL_DATE) || NULL_DATE,
    priority: num(fields.priority),
    project_id: projectId,
    labels: options.labels ?? [],
    reminders: Array.isArray(fields.reminders) ? (fields.reminders as Task['reminders']) : [],
    repeat_after: num(fields.repeat_after),
    repeat_mode: num(fields.repeat_mode),
    percent_done: 0,
    // After everything the server already has; undated tasks sort by position.
    position: 2 ** 40,
    bucket_id: 0,
    identifier: '',
    hex_color: '',
    created: now,
    updated: now,
    created_by: { id: 0, username: '' },
  }
}

/** Split a filter at top-level `&&` (parenthesized groups stay whole). */
function topLevelClauses(filter: string): string[] {
  const clauses: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < filter.length; i++) {
    const char = filter[i]
    if (char === '(') depth++
    else if (char === ')') depth--
    if (depth === 0 && filter.startsWith('&&', i)) {
      clauses.push(current.trim())
      current = ''
      i += 1
      continue
    }
    current += char
  }
  if (current.trim()) clauses.push(current.trim())
  return clauses
}

/**
 * Whether a task could be in the result of a server filter. Understands the clauses the app's own
 * lists use (`done`, `project_id`, a due date that must exist); a clause it does not recognize does
 * not exclude the task, because the views filter exactly afterwards. Used to decide which cached
 * task lists a pending create is added to.
 */
export function taskMayMatchServerFilter(task: Task, filter: string | undefined): boolean {
  if (!filter) return true
  for (const clause of topLevelClauses(filter)) {
    const done = /^done\s*=\s*(true|false)$/.exec(clause)
    if (done) {
      if ((done[1] === 'true') !== task.done) return false
      continue
    }
    const project = /^project_id\s*=\s*(\d+)$/.exec(clause)
    if (project) {
      if (Number(project[1]) !== task.project_id) return false
      continue
    }
    if (/^due_date\s*!=\s*'0001-01-01/.test(clause)) {
      if (!task.due_date || task.due_date === NULL_DATE) return false
    }
  }
  return true
}

/** Add a pending create to the cached lists it belongs to, so it shows up and can be edited. */
export function insertPendingTask(qc: QueryClient, task: Task): void {
  for (const [key, data] of qc.getQueriesData<Task[]>({ queryKey: ['tasks'] })) {
    if (!data || (key as readonly unknown[])[1] === 'search') continue
    if (data.some((t) => t.id === task.id)) continue
    const params = (key as readonly unknown[])[1] as { filter?: string } | undefined
    if (!taskMayMatchServerFilter(task, params?.filter)) continue
    qc.setQueryData(key, [task, ...data])
  }

  for (const [key, data] of qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] })) {
    if (!data || data.some((t) => t.id === task.id)) continue
    if ((key as readonly unknown[])[1] !== task.project_id) continue
    qc.setQueryData(key, sortProjectTasks([...data, task]))
  }

  qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((entry) => {
      if (entry.id !== task.project_id || entry.tasks.some((t) => t.id === task.id)) return entry
      changed = true
      return { ...entry, tasks: sortProjectTasks([...entry.tasks, task]) }
    })
    return changed ? next : old
  })
}

function remapTask(task: Task, idMap: ReadonlyMap<number, number>): Task {
  const realId = idMap.get(task.id)
  let next = realId === undefined ? task : { ...task, id: realId }
  if (task.related_tasks) {
    let relatedChanged = false
    const related = Object.fromEntries(
      Object.entries(task.related_tasks).map(([kind, items]) => {
        const mapped = items.map((item) => {
          const remapped = remapTask(item, idMap)
          if (remapped !== item) relatedChanged = true
          return remapped
        })
        return [kind, mapped]
      }),
    )
    if (relatedChanged) next = { ...next, related_tasks: related }
  }
  return next
}

function remapList(list: Task[] | undefined, idMap: ReadonlyMap<number, number>): Task[] | undefined {
  if (!list) return list
  let changed = false
  const next = list.map((task) => {
    const remapped = remapTask(task, idMap)
    if (remapped !== task) changed = true
    return remapped
  })
  return changed ? next : list
}

/**
 * The replay created tasks that only existed under a temp id: swap in the real ids everywhere the
 * UI holds them, keeping what the user typed, until a refetch brings the server's version.
 * `idMap` is the `{ "-3": 812 }` map of the replay event.
 */
export function remapTempTaskIds(qc: QueryClient, rawIdMap: Readonly<Record<string, number>>): void {
  const idMap = new Map<number, number>()
  for (const [temp, real] of Object.entries(rawIdMap)) {
    const from = Number(temp)
    if (Number.isInteger(from) && from < 0 && real > 0) idMap.set(from, real)
  }
  if (idMap.size === 0) return

  for (const key of ['tasks', 'view-tasks'] as const) {
    qc.setQueriesData<Task[]>({ queryKey: [key] }, (old) => remapList(old, idMap))
  }
  qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((entry) => {
      const tasks = remapList(entry.tasks, idMap)
      if (tasks === entry.tasks) return entry
      changed = true
      return { ...entry, tasks: tasks! }
    })
    return changed ? next : old
  })
  // Detail and attachment queries are keyed by task id: what was fetched under a temp id is gone.
  for (const [temp] of idMap) {
    qc.removeQueries({ queryKey: ['task-detail', temp] })
    qc.removeQueries({ queryKey: ['task-attachments', temp] })
  }
  qc.setQueriesData<Task[]>({ queryKey: ['task-detail'] }, (old) => remapList(old, idMap))
}

/** Apply `change` to the task with this id wherever it is cached (lists, project views, sections, subtask details). */
export function mapTaskInCaches(qc: QueryClient, id: number, change: (task: Task) => Task): void {
  const mapList = (old: Task[] | undefined) => {
    if (!old || !old.some((t) => t.id === id)) return old
    return old.map((t) => (t.id === id ? change(t) : t))
  }
  for (const key of ['tasks', 'view-tasks', 'task-detail'] as const) {
    qc.setQueriesData<Task[]>({ queryKey: [key] }, mapList)
  }
  qc.setQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((entry) => {
      const tasks = mapList(entry.tasks)
      if (tasks === entry.tasks) return entry
      changed = true
      return { ...entry, tasks: tasks! }
    })
    return changed ? next : old
  })
}

export interface TaskCacheSnapshot {
  tasks: Array<[readonly unknown[], Task[] | undefined]>
  views: Array<[readonly unknown[], Task[] | undefined]>
  sections: Array<[readonly unknown[], SectionTaskCacheEntry[] | undefined]>
  details: Array<[readonly unknown[], Task[] | undefined]>
}

/** Everything an optimistic task change can touch, to restore if the change is refused. */
export function snapshotTaskCaches(qc: QueryClient): TaskCacheSnapshot {
  return {
    tasks: qc.getQueriesData<Task[]>({ queryKey: ['tasks'] }),
    views: qc.getQueriesData<Task[]>({ queryKey: ['view-tasks'] }),
    sections: qc.getQueriesData<SectionTaskCacheEntry[]>({ queryKey: ['section-tasks'] }),
    details: qc.getQueriesData<Task[]>({ queryKey: ['task-detail'] }),
  }
}

export function restoreTaskCaches(qc: QueryClient, snapshot: TaskCacheSnapshot): void {
  for (const group of [snapshot.tasks, snapshot.views, snapshot.sections, snapshot.details]) {
    for (const [key, data] of group) qc.setQueryData(key, data)
  }
}
