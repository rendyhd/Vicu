import type { OfflineFailureReason } from '../../shared/offline-queue-types'
import { emptyQueueData, type FailedAction, type QueueData, type QueuedAction } from './types'

const FAILURE_REASONS: ReadonlySet<string> = new Set<OfflineFailureReason>([
  'rejected',
  'conflict',
  'task-gone',
  'not-found',
  'dependency-failed',
  'gave-up',
])

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string' && v !== ''
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/**
 * Validate one stored action. A malformed entry cannot be replayed, so it is skipped (and logged)
 * rather than failing the whole file, which would throw away every good action next to it.
 */
export function normalizeAction(raw: unknown): QueuedAction | null {
  if (!isRecord(raw) || !isString(raw.id) || typeof raw.type !== 'string') return null
  const base = {
    id: raw.id,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    attempts: isInt(raw.attempts) && raw.attempts >= 0 ? raw.attempts : 0,
    ...(typeof raw.title === 'string' && raw.title ? { title: raw.title } : {}),
  }

  switch (raw.type) {
    case 'create':
      if (!isInt(raw.tempId) || raw.tempId >= 0 || !isInt(raw.projectId) || !isRecord(raw.fields)) return null
      return {
        ...base,
        type: 'create',
        tempId: raw.tempId,
        projectId: raw.projectId,
        fields: raw.fields,
        ...(raw.done === true ? { done: true } : {}),
      }
    case 'update':
      if (!isInt(raw.taskId) || !isRecord(raw.patch)) return null
      return { ...base, type: 'update', taskId: raw.taskId, patch: raw.patch }
    case 'delete':
      if (!isInt(raw.taskId)) return null
      return { ...base, type: 'delete', taskId: raw.taskId }
    case 'add-label':
      if (!isInt(raw.taskId)) return null
      if (!isInt(raw.labelId) && !isString(raw.labelTitle)) return null
      return {
        ...base,
        type: 'add-label',
        taskId: raw.taskId,
        ...(isInt(raw.labelId) ? { labelId: raw.labelId } : {}),
        ...(isString(raw.labelTitle) ? { labelTitle: raw.labelTitle } : {}),
      }
    case 'remove-label':
      if (!isInt(raw.taskId) || !isInt(raw.labelId)) return null
      return { ...base, type: 'remove-label', taskId: raw.taskId, labelId: raw.labelId }
    case 'upload-attachment':
      if (!isInt(raw.taskId) || !isString(raw.file) || !isString(raw.mime)) return null
      return {
        ...base,
        type: 'upload-attachment',
        taskId: raw.taskId,
        file: raw.file,
        name: typeof raw.name === 'string' && raw.name ? raw.name : 'image',
        mime: raw.mime,
        ...(raw.addImageToken === true ? { addImageToken: true } : {}),
        ...(raw.uploaded === true ? { uploaded: true } : {}),
      }
    default:
      return null
  }
}

function normalizeFailed(raw: unknown): FailedAction | null {
  if (!isRecord(raw) || !isString(raw.id)) return null
  const action = normalizeAction(raw.action)
  if (!action) return null
  return {
    id: raw.id,
    action,
    error: typeof raw.error === 'string' ? raw.error : 'Unknown error',
    ...(isInt(raw.statusCode) ? { statusCode: raw.statusCode } : {}),
    reason: typeof raw.reason === 'string' && FAILURE_REASONS.has(raw.reason) ? (raw.reason as OfflineFailureReason) : 'rejected',
    failedAt: typeof raw.failedAt === 'string' ? raw.failedAt : new Date(0).toISOString(),
    ...(isString(raw.groupId) ? { groupId: raw.groupId } : {}),
  }
}

/**
 * Turn parsed JSON into queue data. Throws when the file is not a queue at all (so the `.bak` is
 * tried), but tolerates individual bad entries.
 */
export function parseQueueData(json: unknown): QueueData {
  if (!isRecord(json) || !Array.isArray(json.actions)) throw new Error('Not an offline queue file')

  const data = emptyQueueData()
  for (const raw of json.actions) {
    const action = normalizeAction(raw)
    if (action) data.actions.push(action)
    else console.warn('[offline-queue] skipped an unreadable queued action')
  }
  if (Array.isArray(json.failed)) {
    for (const raw of json.failed) {
      const entry = normalizeFailed(raw)
      if (entry) data.failed.push(entry)
    }
  }
  if (isRecord(json.resolved)) {
    for (const [key, value] of Object.entries(json.resolved)) {
      if (isInt(value)) data.resolved[key] = value
    }
  }

  // Temp ids only count down: never hand out one that is still referenced.
  let lowest = isInt(json.lastTempId) && json.lastTempId <= 0 ? json.lastTempId : 0
  for (const a of data.actions) if (a.type === 'create') lowest = Math.min(lowest, a.tempId)
  for (const f of data.failed) if (f.action.type === 'create') lowest = Math.min(lowest, f.action.tempId)
  for (const key of Object.keys(data.resolved)) {
    const n = Number(key)
    if (Number.isInteger(n)) lowest = Math.min(lowest, n)
  }
  data.lastTempId = lowest
  return data
}
