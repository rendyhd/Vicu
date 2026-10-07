import { app } from 'electron'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { JsonFileStore } from './json-file-store'
import { overlayPendingActions } from './cache-overlay'
import { ensureLegacyMigration, STANDALONE_FILENAME, TASK_CACHE_FILENAME } from './offline/legacy-migration'
import { getOfflineQueue } from './offline/service'
import { dueToday } from '../shared/due-dates'

// Two small stores that used to live in one `offline-cache.json` (D-SYNC-5). The pending-action
// queue now has its own file (src/main/offline/), and:
//   - the task cache (`offline-cache.json`) is disposable: it only feeds the offline Quick View.
//     It is held in memory, written asynchronously and never backed up.
//   - standalone tasks (`standalone-tasks.json`) are the only copy of what the user typed in
//     standalone mode, so they keep a backup and are written before each call returns. The file
//     is tiny and written only on a user action.

interface StandaloneTask {
  id: string
  title: string
  description: string
  due_date: string
  priority: number
  done: boolean
  created: string
  updated: string
}

interface TaskCacheData {
  cachedTasks: unknown[] | null
  cachedTasksTimestamp: string | null
}

interface StandaloneData {
  standaloneTasks: StandaloneTask[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

let taskCacheStore: JsonFileStore<TaskCacheData> | null = null
let standaloneStore: JsonFileStore<StandaloneData> | null = null

function taskCache(): JsonFileStore<TaskCacheData> {
  if (taskCacheStore) return taskCacheStore
  const dir = app.getPath('userData')
  ensureLegacyMigration(dir)
  const store = new JsonFileStore<TaskCacheData>({
    path: join(dir, TASK_CACHE_FILENAME),
    backup: false,
    label: 'task cache',
    empty: () => ({ cachedTasks: null, cachedTasksTimestamp: null }),
    parse: (json) => {
      if (!isRecord(json)) throw new Error('Not a task cache')
      return {
        cachedTasks: Array.isArray(json.cachedTasks) ? json.cachedTasks : null,
        cachedTasksTimestamp: typeof json.cachedTasksTimestamp === 'string' ? json.cachedTasksTimestamp : null,
      }
    },
  })
  store.load()
  taskCacheStore = store
  return store
}

function standalone(): JsonFileStore<StandaloneData> {
  if (standaloneStore) return standaloneStore
  const dir = app.getPath('userData')
  ensureLegacyMigration(dir)
  const store = new JsonFileStore<StandaloneData>({
    path: join(dir, STANDALONE_FILENAME),
    backup: true,
    quarantineCorrupt: true,
    label: 'standalone tasks',
    empty: () => ({ standaloneTasks: [] }),
    parse: (json) => {
      if (!isRecord(json) || !Array.isArray(json.standaloneTasks)) throw new Error('Not a standalone task file')
      return { standaloneTasks: json.standaloneTasks as StandaloneTask[] }
    },
  })
  store.load()
  standaloneStore = store
  return store
}

function generateId(): string {
  return randomBytes(8).toString('hex')
}

// --- Task Cache ---

export function setCachedTasks(tasks: unknown[]): void {
  const store = taskCache()
  store.state = { cachedTasks: tasks, cachedTasksTimestamp: new Date().toISOString() }
  store.save().catch((err) => console.warn('[cache] could not save the task cache:', err instanceof Error ? err.message : err))
}

export function getCachedTasks(): { tasks: unknown[] | null; timestamp: string | null } {
  const { cachedTasks, cachedTasksTimestamp } = taskCache().state
  if (!cachedTasks) return { tasks: null, timestamp: null }
  return {
    tasks: overlayPendingActions(cachedTasks, getOfflineQueue().getPending()),
    timestamp: cachedTasksTimestamp,
  }
}

/** Write anything not on disk yet. Called before the app quits. */
export function flushTaskCache(): Promise<void> {
  return taskCacheStore ? taskCacheStore.flush() : Promise.resolve()
}

export function taskCacheHasUnsavedChanges(): boolean {
  return taskCacheStore?.hasUnsavedChanges ?? false
}

// --- Error Classification ---

export { isRetriableError, isConnectionError, isAuthError } from './error-classify'

// --- Standalone Tasks ---

const NO_DUE = '0001-01-01T00:00:00Z'

function tasks(): StandaloneTask[] {
  return standalone().state.standaloneTasks
}

function persistStandalone(): void {
  standalone().saveSync()
}

export function addStandaloneTask(title: string, description: string | null, dueDate: string | null): StandaloneTask {
  const task: StandaloneTask = {
    id: 'local_' + generateId(),
    title,
    description: description || '',
    due_date: dueDate || NO_DUE,
    priority: 0,
    done: false,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }
  tasks().push(task)
  persistStandalone()
  return task
}

export function getStandaloneTasks(sortBy?: string, orderBy?: string): StandaloneTask[] {
  const field = sortBy || 'due_date'
  const asc = (orderBy || 'asc') === 'asc'

  return tasks()
    .filter((t) => !t.done)
    .sort((a, b) => {
      if (field === 'due_date') {
        const aNo = a.due_date === NO_DUE
        const bNo = b.due_date === NO_DUE
        if (aNo !== bNo) return aNo ? 1 : -1
      }

      let cmp: number
      if (field === 'title') {
        cmp = (a.title || '').localeCompare(b.title || '')
      } else if (field === 'priority') {
        cmp = (a.priority || 0) - (b.priority || 0)
      } else {
        cmp = new Date(a[field as keyof StandaloneTask] as string || '0').getTime() -
              new Date(b[field as keyof StandaloneTask] as string || '0').getTime()
      }
      return asc ? cmp : -cmp
    })
    .slice(0, 10)
}

export function getAllStandaloneTasks(): StandaloneTask[] {
  return tasks().filter((t) => !t.done)
}

export function markStandaloneTaskDone(taskId: string): StandaloneTask | null {
  const task = tasks().find((t) => t.id === taskId)
  if (!task) return null
  task.done = true
  task.updated = new Date().toISOString()
  persistStandalone()
  return task
}

export function markStandaloneTaskUndone(taskId: string): StandaloneTask | null {
  const task = tasks().find((t) => t.id === taskId)
  if (!task) return null
  task.done = false
  task.updated = new Date().toISOString()
  persistStandalone()
  return task
}

export function scheduleStandaloneTaskToday(taskId: string): StandaloneTask | null {
  const task = tasks().find((t) => t.id === taskId)
  if (!task) return null
  task.due_date = dueToday()
  task.updated = new Date().toISOString()
  persistStandalone()
  return task
}

export function removeStandaloneTaskDueDate(taskId: string): StandaloneTask | null {
  const task = tasks().find((t) => t.id === taskId)
  if (!task) return null
  task.due_date = NO_DUE
  task.updated = new Date().toISOString()
  persistStandalone()
  return task
}

export function updateStandaloneTask(taskId: string, updates: Record<string, unknown>): StandaloneTask | null {
  const task = tasks().find((t) => t.id === taskId)
  if (!task) return null
  if (updates.title !== undefined) task.title = updates.title as string
  if (updates.description !== undefined) task.description = updates.description as string
  if (updates.due_date !== undefined) task.due_date = updates.due_date as string
  if (typeof updates.priority === 'number') task.priority = updates.priority
  if (typeof updates.done === 'boolean') task.done = updates.done
  task.updated = new Date().toISOString()
  persistStandalone()
  return task
}

/** Remove one task, for example right after it was uploaded to the server. */
export function removeStandaloneTask(taskId: string): void {
  const store = standalone()
  const remaining = store.state.standaloneTasks.filter((t) => t.id !== taskId)
  if (remaining.length === store.state.standaloneTasks.length) return
  store.state.standaloneTasks = remaining
  persistStandalone()
}

export function clearStandaloneTasks(): void {
  standalone().state.standaloneTasks = []
  persistStandalone()
}
