import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { randomBytes } from 'crypto'

const CACHE_FILENAME = 'offline-cache.json'

interface PendingAction {
  id: string
  type: string
  createdAt: string
  title?: string
  description?: string | null
  dueDate?: string | null
  projectId?: number | null
  taskId?: number
  taskData?: Record<string, unknown>
  [key: string]: unknown
}

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

interface CacheData {
  pendingActions: PendingAction[]
  cachedTasks: unknown[] | null
  cachedTasksTimestamp: string | null
  standaloneTasks: StandaloneTask[]
}

function getCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

function loadCache(): CacheData {
  try {
    const raw = readFileSync(getCachePath(), 'utf-8')
    const cache = JSON.parse(raw)
    return {
      pendingActions: Array.isArray(cache.pendingActions) ? cache.pendingActions : [],
      cachedTasks: Array.isArray(cache.cachedTasks) ? cache.cachedTasks : null,
      cachedTasksTimestamp: cache.cachedTasksTimestamp || null,
      standaloneTasks: Array.isArray(cache.standaloneTasks) ? cache.standaloneTasks : [],
    }
  } catch {
    return { pendingActions: [], cachedTasks: null, cachedTasksTimestamp: null, standaloneTasks: [] }
  }
}

function saveCache(cache: CacheData): void {
  const cachePath = getCachePath()
  const dir = dirname(cachePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Write atomically: temp file then rename
  const tmpPath = cachePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(cache, null, 2), 'utf-8')
  renameSync(tmpPath, cachePath)
}

function generateId(): string {
  return randomBytes(8).toString('hex')
}

// --- Pending Actions ---

export function addPendingAction(action: Omit<PendingAction, 'id' | 'createdAt'>): string {
  const cache = loadCache()
  const full: PendingAction = {
    ...action,
    id: generateId(),
    createdAt: new Date().toISOString(),
  }
  cache.pendingActions.push(full)
  saveCache(cache)
  return full.id
}

export function removePendingAction(actionId: string): void {
  const cache = loadCache()
  cache.pendingActions = cache.pendingActions.filter((a) => a.id !== actionId)
  saveCache(cache)
}

export function removePendingActionByTaskId(taskId: number, type: string): boolean {
  const cache = loadCache()
  const index = cache.pendingActions.findIndex(
    (a) => String(a.taskId) === String(taskId) && a.type === type,
  )
  if (index !== -1) {
    cache.pendingActions.splice(index, 1)
    saveCache(cache)
    return true
  }
  return false
}

export function getPendingActions(): PendingAction[] {
  return loadCache().pendingActions
}

export function getPendingCount(): number {
  return loadCache().pendingActions.length
}

// --- Task Cache ---

export function setCachedTasks(tasks: unknown[]): void {
  const cache = loadCache()
  cache.cachedTasks = tasks
  cache.cachedTasksTimestamp = new Date().toISOString()
  saveCache(cache)
}

export function getCachedTasks(): { tasks: unknown[] | null; timestamp: string | null } {
  const cache = loadCache()
  if (!cache.cachedTasks) return { tasks: null, timestamp: null }

  const pendingCompleteIds = cache.pendingActions
    .filter((a) => a.type === 'complete')
    .map((a) => String(a.taskId))

  const tasks = cache.cachedTasks.filter(
    (t: any) => !pendingCompleteIds.includes(String(t.id)),
  )

  // Include tasks created offline
  const pendingCreates = cache.pendingActions
    .filter((a) => a.type === 'create')
    .map((a) => ({
      id: `pending_${a.id}`,
      title: a.title,
      description: a.description || '',
      due_date: a.dueDate || '0001-01-01T00:00:00Z',
      priority: 0,
      done: false,
      created: a.createdAt,
      updated: a.createdAt,
    }))

  tasks.push(...pendingCreates)
  return { tasks, timestamp: cache.cachedTasksTimestamp }
}

// --- Error Classification ---

export function isRetriableError(error: string): boolean {
  if (!error) return false
  const patterns = [
    'timed out', 'Network error', 'network error', 'net::',
    'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
    'EHOSTUNREACH', 'ENETUNREACH', 'fetch failed', 'socket hang up',
    'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED',
    'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_TIMED_OUT', 'ERR_ADDRESS_UNREACHABLE',
    'Server error',
  ]
  return patterns.some((p) => error.includes(p))
}

export function isAuthError(error: string): boolean {
  if (!error) return false
  return (
    error.includes('API token is invalid') ||
    error.includes('API token has insufficient') ||
    error.includes('API token lacks')
  )
}

// --- Standalone Tasks ---

export function addStandaloneTask(title: string, description: string | null, dueDate: string | null): StandaloneTask {
  const cache = loadCache()
  const task: StandaloneTask = {
    id: 'local_' + generateId(),
    title,
    description: description || '',
    due_date: dueDate || '0001-01-01T00:00:00Z',
    priority: 0,
    done: false,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  }
  cache.standaloneTasks.push(task)
  saveCache(cache)
  return task
}

export function getStandaloneTasks(sortBy?: string, orderBy?: string): StandaloneTask[] {
  const cache = loadCache()
  const field = sortBy || 'due_date'
  const asc = (orderBy || 'asc') === 'asc'
  const NO_DUE = '0001-01-01T00:00:00Z'

  return cache.standaloneTasks
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
  return loadCache().standaloneTasks.filter((t) => !t.done)
}

export function markStandaloneTaskDone(taskId: string): StandaloneTask | null {
  const cache = loadCache()
  const task = cache.standaloneTasks.find((t) => t.id === taskId)
  if (!task) return null
  task.done = true
  task.updated = new Date().toISOString()
  saveCache(cache)
  return task
}

export function markStandaloneTaskUndone(taskId: string): StandaloneTask | null {
  const cache = loadCache()
  const task = cache.standaloneTasks.find((t) => t.id === taskId)
  if (!task) return null
  task.done = false
  task.updated = new Date().toISOString()
  saveCache(cache)
  return task
}

export function scheduleStandaloneTaskToday(taskId: string): StandaloneTask | null {
  const cache = loadCache()
  const task = cache.standaloneTasks.find((t) => t.id === taskId)
  if (!task) return null
  const now = new Date()
  task.due_date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
  task.updated = new Date().toISOString()
  saveCache(cache)
  return task
}

export function removeStandaloneTaskDueDate(taskId: string): StandaloneTask | null {
  const cache = loadCache()
  const task = cache.standaloneTasks.find((t) => t.id === taskId)
  if (!task) return null
  task.due_date = '0001-01-01T00:00:00Z'
  task.updated = new Date().toISOString()
  saveCache(cache)
  return task
}

export function updateStandaloneTask(taskId: string, updates: Record<string, unknown>): StandaloneTask | null {
  const cache = loadCache()
  const task = cache.standaloneTasks.find((t) => t.id === taskId)
  if (!task) return null
  if (updates.title !== undefined) task.title = updates.title as string
  if (updates.description !== undefined) task.description = updates.description as string
  task.updated = new Date().toISOString()
  saveCache(cache)
  return task
}

export function clearStandaloneTasks(): void {
  const cache = loadCache()
  cache.standaloneTasks = []
  saveCache(cache)
}
