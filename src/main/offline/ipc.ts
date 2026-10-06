import { handleTrusted } from '../secure-ipc'
import { replayPendingActions } from '../sync'
import type {
  OfflineCreateInput,
  OfflineCreateResult,
  OfflineEnqueueResult,
  OfflineQueueResult,
  OfflineQueueSnapshot,
  OfflineReplayEvent,
} from '../../shared/offline-queue-types'
import { parseQueuedImages, parseQueuedLabels } from './parse-input'
import { getOfflineQueue } from './service'

// IPC surface of the offline queue for the main window (plan 5.3 / decision 4). Every handler
// answers `{ success: true, data }` or `{ success: false, error }` like the API calls do, and
// validates what the renderer sent: the queue is persistent state, so a malformed call must fail
// loudly instead of being stored.
//
// Events the queue sends to the windows (see OFFLINE_EVENTS in ./service.ts):
//   offline-queue:changed       { counts, replaying, authProblem }  after every change
//   offline-queue:replayed      OfflineReplayEvent                  when a replay finishes
//   offline-queue:auth-problem  { error }                           replay paused on a session problem

function isTaskRef(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseMeta(value: unknown): { title?: string } {
  return isPlainObject(value) && typeof value.title === 'string' && value.title ? { title: value.title } : {}
}

function parseIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error('Expected a list of action ids')
  return value.filter((v): v is string => typeof v === 'string')
}

async function run<T>(fn: () => Promise<T> | T): Promise<OfflineQueueResult<T>> {
  try {
    return { success: true, data: await fn() }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerOfflineQueueIpc(): void {
  handleTrusted('offline-queue:snapshot', () => run<OfflineQueueSnapshot>(() => getOfflineQueue().snapshot()))

  handleTrusted('offline-queue:enqueue-update', (_event, taskRef: unknown, patch: unknown, meta?: unknown) =>
    run<OfflineEnqueueResult>(() => {
      if (!isTaskRef(taskRef) || !isPlainObject(patch)) throw new Error('Invalid update')
      return getOfflineQueue().enqueueUpdate(taskRef, patch, parseMeta(meta))
    })
  )

  handleTrusted('offline-queue:enqueue-complete', (_event, taskRef: unknown, done: unknown, meta?: unknown) =>
    run<OfflineEnqueueResult>(() => {
      if (!isTaskRef(taskRef) || typeof done !== 'boolean') throw new Error('Invalid completion')
      return getOfflineQueue().enqueueComplete(taskRef, done, parseMeta(meta))
    })
  )

  handleTrusted('offline-queue:enqueue-delete', (_event, taskRef: unknown, meta?: unknown) =>
    run<OfflineEnqueueResult>(() => {
      if (!isTaskRef(taskRef)) throw new Error('Invalid delete')
      return getOfflineQueue().enqueueDelete(taskRef, parseMeta(meta))
    })
  )

  handleTrusted('offline-queue:enqueue-create', (_event, input: unknown) =>
    run<OfflineCreateResult>(() => {
      if (!isPlainObject(input) || typeof input.projectId !== 'number' || !isPlainObject(input.fields)) {
        throw new Error('Invalid create')
      }
      const create: OfflineCreateInput = {
        projectId: input.projectId,
        fields: input.fields,
        done: input.done === true,
        labels: parseQueuedLabels(input.labels),
        images: parseQueuedImages(input.images),
      }
      return getOfflineQueue().enqueueCreate(create)
    })
  )

  handleTrusted('offline-queue:enqueue-add-label', (_event, taskRef: unknown, label: unknown, meta?: unknown) =>
    run<OfflineEnqueueResult>(() => {
      const [ref] = parseQueuedLabels([label])
      if (!isTaskRef(taskRef) || !ref) throw new Error('Invalid label')
      return getOfflineQueue().enqueueAddLabel(taskRef, ref, parseMeta(meta))
    })
  )

  handleTrusted('offline-queue:enqueue-remove-label', (_event, taskRef: unknown, labelId: unknown, meta?: unknown) =>
    run<OfflineEnqueueResult>(() => {
      if (!isTaskRef(taskRef) || typeof labelId !== 'number') throw new Error('Invalid label')
      return getOfflineQueue().enqueueRemoveLabel(taskRef, labelId, parseMeta(meta))
    })
  )

  handleTrusted('offline-queue:cancel-change', (_event, taskRef: unknown, keys: unknown) =>
    run<boolean>(() => {
      if (!isTaskRef(taskRef) || !Array.isArray(keys)) throw new Error('Invalid cancel')
      return getOfflineQueue().cancelChange(taskRef, keys.filter((k): k is string => typeof k === 'string'))
    })
  )

  handleTrusted('offline-queue:retry-failed', (_event, ids?: unknown) =>
    run<number>(async () => {
      const count = await getOfflineQueue().retryFailed(parseIds(ids))
      if (count > 0) void replayPendingActions()
      return count
    })
  )

  handleTrusted('offline-queue:discard-failed', (_event, ids?: unknown) =>
    run<number>(() => getOfflineQueue().discardFailed(parseIds(ids)))
  )

  handleTrusted('offline-queue:discard-pending', (_event, ids: unknown) =>
    run<number>(() => getOfflineQueue().discardPending(parseIds(ids) ?? []))
  )

  handleTrusted('offline-queue:replay-now', () =>
    run<OfflineReplayEvent | null>(() => replayPendingActions())
  )
}
