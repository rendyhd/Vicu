import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { stripBom, writeFileAtomic } from '../atomic-file'
import { sanitizeTaskPatch } from '../../shared/merge-patches'
import { mergeUpdate } from './queue-merge'
import { emptyQueueData, type QueuedAction, type UpdateAction } from './types'

export const TASK_CACHE_FILENAME = 'offline-cache.json'
export const QUEUE_FILENAME = 'offline-queue.json'
export const STANDALONE_FILENAME = 'standalone-tasks.json'

export interface MigrationResult {
  migrated: boolean
  actions?: number
  standaloneTasks?: number
  error?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** What a legacy `update-task` entry changed (the old Quick View's inline edit). */
const LEGACY_EDITABLE_FIELDS = ['title', 'description'] as const

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of keys) if (key in source) picked[key] = source[key]
  return picked
}

function toUpdate(
  legacy: Record<string, unknown>,
  patch: Record<string, unknown>,
  taskId: number
): UpdateAction | null {
  const clean = { ...sanitizeTaskPatch(patch) }
  if (Object.keys(clean).length === 0) return null
  const title = isRecord(legacy.taskData) && typeof legacy.taskData.title === 'string' ? legacy.taskData.title : undefined
  return {
    id: String(legacy.id),
    type: 'update',
    taskId,
    patch: clean,
    createdAt: typeof legacy.createdAt === 'string' ? legacy.createdAt : new Date(0).toISOString(),
    attempts: 0,
    ...(title ? { title } : {}),
  }
}

/**
 * Convert the old queue format (snapshots under `taskData`, one action per click) into patch
 * actions. The stale snapshots are deliberately not carried over: replaying them would overwrite
 * later edits from other devices (D-SYNC-2). Entries the old replay would have skipped (a create
 * with no project, an unknown type, an update with no task id) are dropped here too.
 */
export function convertLegacyActions(legacy: unknown[]): { actions: QueuedAction[]; lastTempId: number } {
  let actions: QueuedAction[] = []
  let lastTempId = 0

  for (const raw of legacy) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string') continue
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString()
    const taskId = typeof raw.taskId === 'number' && Number.isInteger(raw.taskId) && raw.taskId > 0 ? raw.taskId : null

    if (raw.type === 'create') {
      if (typeof raw.title !== 'string' || !raw.title || typeof raw.projectId !== 'number' || raw.projectId <= 0) continue
      const fields: Record<string, unknown> = { title: raw.title }
      if (typeof raw.description === 'string' && raw.description) fields.description = raw.description
      if (typeof raw.dueDate === 'string' && raw.dueDate && !raw.dueDate.startsWith('0001-01-01')) fields.due_date = raw.dueDate
      lastTempId -= 1
      actions.push({ id: raw.id, type: 'create', tempId: lastTempId, projectId: raw.projectId, fields, createdAt, attempts: 0, title: raw.title })
      continue
    }

    if (taskId === null) continue
    let update: UpdateAction | null = null
    switch (raw.type) {
      case 'complete':
        update = toUpdate(raw, { done: true }, taskId)
        break
      case 'uncomplete':
        update = toUpdate(raw, { done: false }, taskId)
        break
      case 'schedule-today':
        if (typeof raw.dueDate === 'string') update = toUpdate(raw, { due_date: raw.dueDate }, taskId)
        break
      case 'remove-due-date':
        update = toUpdate(raw, { due_date: null }, taskId)
        break
      case 'update-task':
        // The old Quick View only ever changed the title and the description. Its `taskData` is a
        // full snapshot of the row as it was when the edit was made: every other field in it is
        // stale and would overwrite what changed on the server since.
        if (isRecord(raw.taskData)) update = toUpdate(raw, pick(raw.taskData, LEGACY_EDITABLE_FIELDS), taskId)
        break
    }
    if (update) actions = mergeUpdate(actions, update, null).actions
  }

  return { actions, lastTempId }
}

function readJson(path: string): unknown {
  return JSON.parse(stripBom(readFileSync(path, 'utf-8')))
}

/**
 * Split the old combined `offline-cache.json` (pending actions + task cache + standalone tasks) into
 * `offline-queue.json`, `standalone-tasks.json` and a cache file that holds only the task cache
 * (D-SYNC-5). Runs once, synchronously, at startup before anything reads those files.
 *
 * Safe to interrupt and to repeat: the new files are written first and only then is the cache file
 * rewritten, and a new file that already exists is never overwritten. The previous combined file
 * is kept as `offline-cache.json.bak`, which is how a conversion mistake could be recovered by hand.
 */
export function migrateLegacyCache(dir: string): MigrationResult {
  const cachePath = join(dir, TASK_CACHE_FILENAME)
  if (!existsSync(cachePath)) return { migrated: false }

  let parsed: unknown
  try {
    parsed = readJson(cachePath)
  } catch (err) {
    return { migrated: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!isRecord(parsed) || !('pendingActions' in parsed || 'standaloneTasks' in parsed)) return { migrated: false }

  const legacyActions = Array.isArray(parsed.pendingActions) ? parsed.pendingActions : []
  const standalone = Array.isArray(parsed.standaloneTasks) ? parsed.standaloneTasks : []

  const queuePath = join(dir, QUEUE_FILENAME)
  let actionCount = 0
  if (legacyActions.length > 0 && !existsSync(queuePath)) {
    const converted = convertLegacyActions(legacyActions)
    actionCount = converted.actions.length
    if (actionCount > 0) {
      const data = { ...emptyQueueData(), actions: converted.actions, lastTempId: converted.lastTempId }
      writeFileAtomic(queuePath, JSON.stringify(data))
    }
  }

  const standalonePath = join(dir, STANDALONE_FILENAME)
  if (standalone.length > 0 && !existsSync(standalonePath)) {
    writeFileAtomic(standalonePath, JSON.stringify({ standaloneTasks: standalone }))
  }

  writeFileAtomic(
    cachePath,
    JSON.stringify({
      cachedTasks: Array.isArray(parsed.cachedTasks) ? parsed.cachedTasks : null,
      cachedTasksTimestamp: typeof parsed.cachedTasksTimestamp === 'string' ? parsed.cachedTasksTimestamp : null,
    }),
    { backup: true }
  )

  console.warn(`[offline] split ${TASK_CACHE_FILENAME}: ${actionCount} queued action(s), ${standalone.length} standalone task(s)`)
  return { migrated: true, actions: actionCount, standaloneTasks: standalone.length }
}

const migratedDirs = new Set<string>()

/** `migrateLegacyCache` once per folder per process; the stores call this before their first read. */
export function ensureLegacyMigration(dir: string): void {
  if (migratedDirs.has(dir)) return
  migratedDirs.add(dir)
  try {
    migrateLegacyCache(dir)
  } catch (err) {
    // Never block startup: the old file is untouched until the new ones are written.
    console.warn('[offline] could not split the legacy cache file:', err instanceof Error ? err.message : err)
  }
}
