import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The task write channels (update-task, delete-task, add-label-to-task, remove-label-from-task)
// register through the real ipc-handlers module against stubbed collaborators. They go through the
// write gate (offline/task-writes.ts): this checks the wiring, the gate's own rules are tested in
// offline-task-writes.test.ts.

const hoisted = vi.hoisted(() => {
  const queue = {
    waiting: false,
    pending: 0,
    hasPendingFor: (_id: number) => queue.waiting,
    counts: () => ({ pending: queue.pending, failed: 0 }),
    enqueueUpdate: vi.fn(async (..._args: unknown[]) => ({ actionId: 'a', taskId: 5, folded: false })),
    enqueueDelete: vi.fn(async (..._args: unknown[]) => ({ actionId: 'a', taskId: 5, folded: false })),
    enqueueAddLabel: vi.fn(async (..._args: unknown[]) => ({ actionId: 'a', taskId: 5, folded: false })),
    enqueueRemoveLabel: vi.fn(async (..._args: unknown[]) => ({ actionId: 'a', taskId: 5, folded: false })),
  }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    viewerSend: vi.fn(),
    mainSend: vi.fn(),
    forgetDeletedTask: vi.fn(),
    replay: vi.fn(async () => null),
    api: {} as Record<string, ReturnType<typeof vi.fn>>,
    queue,
  }
})

vi.mock('electron', () => ({
  shell: {},
  dialog: {},
  app: { getPath: () => '' },
  nativeTheme: {},
  ipcMain: { handle: () => undefined },
}))
vi.mock('../secure-ipc', () => ({
  handleTrusted: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
    hoisted.handlers.set(channel, listener)
  },
}))
vi.mock('../api-client', () => {
  const entries = Object.fromEntries(['updateTask', 'deleteTask', 'addLabelToTask', 'removeLabelFromTask', 'createTask', 'updateTaskPosition', 'createTaskRelation', 'deleteTaskRelation'].map((name) => {
    const fn = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ success: true, data: { id: 5 } }))
    hoisted.api[name] = fn
    return [name, fn]
  }))
  return { ...entries, checkUploadSize: vi.fn() }
})
vi.mock('../quick-entry-state', () => ({
  getQuickViewWindow: () => ({ isDestroyed: () => false, webContents: { send: hoisted.viewerSend } }),
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 1, send: hoisted.mainSend } }),
}))
vi.mock('../quick-entry/viewer-caches', () => ({ invalidateViewerCaches: () => undefined, activeProjects: {}, projectListViewIds: {} }))
vi.mock('../offline/ipc', () => ({ registerOfflineQueueIpc: () => undefined }))
vi.mock('../offline/service', () => ({ getOfflineQueue: () => hoisted.queue, rememberKnownUser: () => undefined }))
vi.mock('../offline/quick-actions', () => ({}))
vi.mock('../sync', () => ({ accountChanged: () => undefined, replayPendingActions: hoisted.replay }))
vi.mock('../carrier-service', () => ({
  forgetDeletedTask: hoisted.forgetDeletedTask,
  loadRoutineCarriers: async () => ({ success: true, data: [] }),
  rememberCreatedTask: () => undefined,
}))
vi.mock('../config', () => ({
  loadConfig: () => null,
  saveConfig: () => undefined,
  applyConfigPatch: (c: unknown) => c,
  applyConnectionFields: (c: unknown) => c,
  isConnectionFields: () => true,
  normalizeConfig: (c: unknown) => c,
}))
vi.mock('../custom-list-service', () => ({}))
vi.mock('../auth/oidc-discovery', () => ({}))
vi.mock('../auth/user-info', () => ({}))
vi.mock('../auth/auth-manager', () => ({ authManager: {} }))
vi.mock('../auth/oidc-login', () => ({ OidcTotpRequiredError: class extends Error {} }))
vi.mock('../auth/token-store', () => ({ API_TOKEN_NO_EXPIRY: 0 }))
vi.mock('../notifications', () => ({}))
vi.mock('../badge', () => ({ setTaskBadge: () => undefined, clearTaskBadge: () => undefined }))
vi.mock('../obsidian-client', () => ({}))
vi.mock('../browser-host-registration', () => ({}))
vi.mock('../update-checker', () => ({}))
vi.mock('../sound', () => ({}))
vi.mock('../print', () => ({}))
vi.mock('../standalone-upload', () => ({}))
vi.mock('../cache', () => ({}))
vi.mock('../upload-file', () => ({}))

import { registerIpcHandlers } from '../ipc-handlers'

const call = async (channel: string, ...args: unknown[]) => {
  const handler = hoisted.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({ sender: { id: 7 } }, ...args)
}

describe('task writes go through the write gate', () => {
  // Replay requests are throttled per minute-ish window; every test starts well after the last one.
  let clock = Date.parse('2026-10-07T10:00:00Z')

  beforeEach(() => {
    clock += 60_000
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(clock)
    hoisted.handlers.clear()
    for (const fn of [
      hoisted.viewerSend,
      hoisted.mainSend,
      hoisted.forgetDeletedTask,
      hoisted.replay,
      ...Object.values(hoisted.api),
      hoisted.queue.enqueueUpdate,
      hoisted.queue.enqueueDelete,
      hoisted.queue.enqueueAddLabel,
      hoisted.queue.enqueueRemoveLabel,
    ]) {
      fn.mockClear()
    }
    hoisted.queue.waiting = false
    hoisted.queue.pending = 0
    registerIpcHandlers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('update-task', () => {
    it('sends the change and tells the other windows when nothing waits for the task', async () => {
      const result = await call('update-task', 5, { title: 'EDIT1' }, { queue: true, title: 'T' })

      expect(hoisted.api.updateTask).toHaveBeenCalledWith(5, { title: 'EDIT1' })
      expect(result).toEqual({ success: true, data: { id: 5 } })
      expect(hoisted.viewerSend).toHaveBeenCalledWith('sync-completed')
      expect(hoisted.mainSend).toHaveBeenCalledWith('tasks-changed')
    })

    it('queues the change behind waiting changes without sending it (the EDIT1 / EDIT2 overwrite)', async () => {
      hoisted.queue.waiting = true

      const result = await call('update-task', 5, { title: 'EDIT2' }, { queue: true, title: 'T' })

      expect(result).toEqual({ success: true, queued: true, data: null })
      expect(hoisted.api.updateTask).not.toHaveBeenCalled()
      expect(hoisted.queue.enqueueUpdate).toHaveBeenCalledWith(5, { title: 'EDIT2' }, { title: 'T' })
      expect(hoisted.viewerSend).not.toHaveBeenCalled()
    })

    it('queues a change the server cannot take', async () => {
      hoisted.api.updateTask.mockResolvedValueOnce({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' })

      const result = await call('update-task', 5, { priority: 2 }, { queue: true })

      expect(result).toEqual({ success: true, queued: true, data: null })
      expect(hoisted.queue.enqueueUpdate).toHaveBeenCalledWith(5, { priority: 2 }, {})
    })

    it('refuses a caller that did not ask to be queued while changes wait, and sends nothing', async () => {
      hoisted.queue.waiting = true

      const result = await call('update-task', 5, { title: 'x' })

      expect(result).toMatchObject({ success: false })
      expect(hoisted.api.updateTask).not.toHaveBeenCalled()
      expect(hoisted.queue.enqueueUpdate).not.toHaveBeenCalled()
    })

    it('passes a failure to a caller that did not ask to be queued', async () => {
      hoisted.api.updateTask.mockResolvedValueOnce({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' })

      expect(await call('update-task', 5, { title: 'x' })).toEqual({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' })
      expect(hoisted.queue.enqueueUpdate).not.toHaveBeenCalled()
    })

    it('asks for a replay when a change got through while others wait, and not again within a few seconds', async () => {
      hoisted.queue.pending = 2
      await call('update-task', 5, { title: 'x' }, { queue: true })
      await call('update-task', 6, { title: 'y' }, { queue: true })
      expect(hoisted.replay).toHaveBeenCalledTimes(1)

      vi.setSystemTime(clock + 6_000)
      await call('update-task', 7, { title: 'z' }, { queue: true })
      expect(hoisted.replay).toHaveBeenCalledTimes(2)
    })
  })

  describe('delete-task', () => {
    it('deletes and forgets the task when nothing waits', async () => {
      expect(await call('delete-task', 5, { queue: true })).toEqual({ success: true, data: { id: 5 } })
      expect(hoisted.forgetDeletedTask).toHaveBeenCalledWith(5)
    })

    it('queues the delete behind waiting changes and keeps the task known', async () => {
      hoisted.queue.waiting = true
      expect(await call('delete-task', 5, { queue: true, title: 'T' })).toEqual({ success: true, queued: true, data: null })
      expect(hoisted.api.deleteTask).not.toHaveBeenCalled()
      expect(hoisted.queue.enqueueDelete).toHaveBeenCalledWith(5, { title: 'T' })
      expect(hoisted.forgetDeletedTask).not.toHaveBeenCalled()
    })
  })

  describe('labels', () => {
    it('queues an add behind waiting changes, keeping the label title for the queue', async () => {
      hoisted.queue.waiting = true
      const result = await call('add-label-to-task', 5, 3, { queue: true, title: 'T', labelTitle: 'home' })
      expect(result).toEqual({ success: true, queued: true, data: null })
      expect(hoisted.api.addLabelToTask).not.toHaveBeenCalled()
      expect(hoisted.queue.enqueueAddLabel).toHaveBeenCalledWith(5, { id: 3, title: 'home' }, { title: 'T' })
    })

    it('sends an add when nothing waits and refreshes Quick View', async () => {
      await call('add-label-to-task', 5, 3, { queue: true })
      expect(hoisted.api.addLabelToTask).toHaveBeenCalledWith(5, 3)
      expect(hoisted.viewerSend).toHaveBeenCalledWith('sync-completed')
    })

    it('queues a removal behind waiting changes', async () => {
      hoisted.queue.waiting = true
      expect(await call('remove-label-from-task', 5, 3, { queue: true })).toEqual({ success: true, queued: true, data: null })
      expect(hoisted.api.removeLabelFromTask).not.toHaveBeenCalled()
      expect(hoisted.queue.enqueueRemoveLabel).toHaveBeenCalledWith(5, 3, {})
    })

    it('refuses a label change from a caller that cannot queue while changes wait', async () => {
      hoisted.queue.waiting = true
      expect(await call('add-label-to-task', 5, 3)).toMatchObject({ success: false })
      expect(hoisted.api.addLabelToTask).not.toHaveBeenCalled()
    })
  })

  describe('writes without the gate still leave one at a time', () => {
    it('create-task, update-task-position and relations wait for the request in front', async () => {
      let inFlight = 0
      let peak = 0
      const slow = async (): Promise<unknown> => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return { success: true, data: { id: 5 } }
      }
      hoisted.api.createTask.mockImplementationOnce(slow)
      hoisted.api.updateTaskPosition.mockImplementationOnce(slow)
      hoisted.api.createTaskRelation.mockImplementationOnce(slow)
      hoisted.api.deleteTaskRelation.mockImplementationOnce(slow)
      hoisted.api.updateTask.mockImplementationOnce(slow)

      await Promise.all([
        call('create-task', 1, { title: 'A' }),
        call('update-task-position', 5, 2, 10),
        call('create-task-relation', 5, 6, 'subtask'),
        call('delete-task-relation', 5, 'subtask', 6),
        call('update-task', 5, { done: true }, { queue: true }),
      ])

      expect(peak).toBe(1)
      for (const name of ['createTask', 'updateTaskPosition', 'createTaskRelation', 'deleteTaskRelation', 'updateTask']) {
        expect(hoisted.api[name]).toHaveBeenCalledTimes(1)
      }
    })
  })
})
