import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OfflineReplayEvent } from '../../shared/offline-queue-types'

// What a finished replay tells the rest of the app (sync.ts announce): the sidebar rings must count
// again after an offline drain, in main (cache) and in the main window (refetch on tasks-changed).

const hoisted = vi.hoisted(() => ({
  order: [] as string[],
  invalidate: vi.fn(),
  mainSend: vi.fn(),
  sendToAppWindows: vi.fn(),
}))

vi.mock('../config', () => ({ loadConfig: () => null }))
vi.mock('../api-client', () => Object.fromEntries(['fetchTasks', 'addLabelToTask', 'createLabel', 'createTask', 'deleteTask', 'fetchLabels', 'fetchTaskAttachments', 'fetchTaskById', 'removeLabelFromTask', 'updateTask', 'uploadTaskAttachment'].map((name) => [name, () => undefined])))
vi.mock('../offline/service', () => ({
  OFFLINE_EVENTS: { replayed: 'replayed', authProblem: 'auth-problem' },
  forgetKnownUser: () => undefined,
  getOfflineQueue: () => ({}),
  knownUserIdFor: () => undefined,
  rememberKnownUser: () => undefined,
  sendToAppWindows: hoisted.sendToAppWindows,
}))
vi.mock('../auth/user-info', () => ({}))
vi.mock('../auth/auth-manager', () => ({ authManager: {} }))
vi.mock('../auth/token-store', () => ({}))
vi.mock('../offline/duplicate-match', () => ({}))
vi.mock('../offline/replay', () => ({ createReplayRunner: () => async () => null, replayQueue: async () => null }))
vi.mock('../offline/task-writes', () => ({ sendSerially: async (fn: () => unknown) => fn() }))
vi.mock('../offline/replay-retry', () => ({ createReplayRetry: () => ({ afterReplay: () => undefined }) }))
vi.mock('../api-v2', () => ({ KEEP_NESTED_SUBTASKS_PARAM: 'k' }))
vi.mock('../quick-entry/viewer-caches', () => ({ invalidateViewerCaches: () => undefined }))
vi.mock('../project-counts-service', () => ({
  invalidateProjectCounts: (...args: unknown[]) => {
    hoisted.order.push('invalidate')
    hoisted.invalidate(...args)
  },
}))
vi.mock('../quick-entry-state', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: {
      send: (channel: string) => {
        hoisted.order.push(channel)
        hoisted.mainSend(channel)
      },
    },
  }),
  getQuickViewWindow: () => null,
  getQuickEntryWindow: () => null,
}))

import { announce } from '../sync'

const event = (over: Partial<OfflineReplayEvent> = {}): OfflineReplayEvent => ({
  applied: 0,
  failed: 0,
  stopped: null,
  idMap: {},
  counts: { pending: 0, failed: 0 },
  ...over,
})

describe('announcing a finished replay', () => {
  beforeEach(() => {
    hoisted.order.length = 0
    hoisted.invalidate.mockClear()
    hoisted.mainSend.mockClear()
  })

  it('drops the cached project counts before the main window is told to refetch', () => {
    announce(event({ applied: 3 }))
    expect(hoisted.invalidate).toHaveBeenCalledWith()
    expect(hoisted.mainSend).toHaveBeenCalledWith('tasks-changed')
    expect(hoisted.order.indexOf('invalidate')).toBeLessThan(hoisted.order.indexOf('tasks-changed'))
  })

  it('leaves the counts alone when nothing was applied', () => {
    announce(event({ applied: 0, failed: 2 }))
    expect(hoisted.invalidate).not.toHaveBeenCalled()
    announce(event())
    expect(hoisted.invalidate).not.toHaveBeenCalled()
  })
})
