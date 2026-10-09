import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Which writes drop the cached project counts behind the sidebar rings: a create (the whole cache
// when the task is a routine or custom-list carrier), and every Quick Entry create and Quick View
// completion or reopening. Registers the real ipc-handlers module against stubbed collaborators.

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
    invalidateCounts: vi.fn(),
    isCarrier: { current: false },
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
// The Quick Entry / Quick View actions call the notifyMainWindow dep when their change went through.
vi.mock('../offline/quick-actions', () => ({
  createFromQuickEntry: async (deps: { notifyMainWindow: () => void }) => { deps.notifyMainWindow(); return { success: true, data: { id: 9 } } },
  quickViewComplete: async (deps: { notifyMainWindow: () => void }) => { deps.notifyMainWindow(); return { success: true } },
  quickViewReopen: async (deps: { notifyMainWindow: () => void }) => { deps.notifyMainWindow(); return { success: true } },
}))
vi.mock('../project-counts-service', () => ({
  countProjectTasks: async () => ({ success: true, data: 0 }),
  invalidateProjectCounts: hoisted.invalidateCounts,
}))
vi.mock('../sync', () => ({ accountChanged: () => undefined, replayPendingActions: hoisted.replay }))
vi.mock('../carrier-service', () => ({
  forgetDeletedTask: hoisted.forgetDeletedTask,
  loadRoutineCarriers: async () => ({ success: true, data: [] }),
  rememberCreatedTask: () => hoisted.isCarrier.current,
}))
vi.mock('../config', () => ({
  loadConfig: () => ({ standalone_mode: false, inbox_project_id: 4, quick_entry_default_project_id: 0 }),
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

describe('project counts are dropped when tasks change outside the main window', () => {
  beforeEach(() => {
    hoisted.handlers.clear()
    hoisted.invalidateCounts.mockClear()
    hoisted.isCarrier.current = false
    registerIpcHandlers()
  })

  it('create-task drops that project only', async () => {
    await call('create-task', 12, { title: 'T' })
    expect(hoisted.invalidateCounts).toHaveBeenCalledWith(12)
  })

  it('create-task of a carrier drops every project, because the carriers are subtracted from the totals', async () => {
    hoisted.isCarrier.current = true
    await call('create-task', 12, { title: 'Routine' })
    expect(hoisted.invalidateCounts).toHaveBeenCalledWith(undefined)
  })

  it('qe:save-task (Quick Entry create) drops the counts', async () => {
    await call('qe:save-task', 'Title', null, null, null)
    expect(hoisted.invalidateCounts).toHaveBeenCalled()
  })

  it('qv:mark-task-done and qv:mark-task-undone (Quick View) drop the counts', async () => {
    await call('qv:mark-task-done', 5, { id: 5 })
    expect(hoisted.invalidateCounts).toHaveBeenCalledTimes(1)
    await call('qv:mark-task-undone', 5, { id: 5 })
    expect(hoisted.invalidateCounts).toHaveBeenCalledTimes(2)
  })
})
