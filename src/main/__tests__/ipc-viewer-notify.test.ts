import { beforeEach, describe, expect, it, vi } from 'vitest'

// Registers the real ipc-handlers module against stubbed collaborators and checks which calls
// tell Quick View to refresh (D-IPC-4).

const hoisted = vi.hoisted(() => {
  const ok = { success: true, data: {} }
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    ok,
    send: vi.fn(),
    result: { current: ok as { success: boolean; error?: string; data?: unknown } },
    invalidate: vi.fn(),
    api: {} as Record<string, ReturnType<typeof vi.fn>>,
    apiNames: [
      'addLabelToTask', 'removeLabelFromTask', 'createLabel', 'updateLabel', 'deleteLabel',
      'createTaskRelation', 'deleteTaskRelation',
      'createProject', 'updateProject', 'deleteProject',
      'uploadTaskAttachment', 'deleteTaskAttachment',
    ],
  }
})

vi.mock('electron', () => ({
  shell: {},
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\files\a.txt'] }) },
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
  const entries = Object.fromEntries(hoisted.apiNames.map((name) => {
    const fn = vi.fn(async () => hoisted.result.current)
    hoisted.api[name] = fn
    return [name, fn]
  }))
  return { ...entries, checkUploadSize: vi.fn() }
})
vi.mock('../quick-entry-state', () => ({
  getQuickViewWindow: () => ({ isDestroyed: () => false, webContents: { send: hoisted.send } }),
  getMainWindow: () => null,
}))
vi.mock('../quick-entry/viewer-caches', () => ({
  invalidateViewerCaches: () => hoisted.invalidate(),
  activeProjects: {},
  projectListViewIds: {},
}))
vi.mock('../offline/ipc', () => ({ registerOfflineQueueIpc: () => undefined }))
vi.mock('../offline/service', () => ({ getOfflineQueue: () => ({}), rememberKnownUser: () => undefined }))
vi.mock('../offline/quick-actions', () => ({}))
vi.mock('../sync', () => ({ accountChanged: () => undefined, replayPendingActions: async () => null }))
vi.mock('../carrier-service', () => ({
  forgetDeletedTask: () => undefined,
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
vi.mock('../upload-file', () => ({ loadFileForUpload: async () => ({ ok: true, buffer: Buffer.from('x') }) }))

import { registerIpcHandlers } from '../ipc-handlers'

const call = async (channel: string, ...args: unknown[]) => {
  const handler = hoisted.handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return handler({ sender: { id: 1 } }, ...args)
}

describe('Quick View refresh after label, relation, attachment and project changes', () => {
  beforeEach(() => {
    hoisted.handlers.clear()
    hoisted.send.mockClear()
    hoisted.invalidate.mockClear()
    hoisted.result.current = hoisted.ok
    registerIpcHandlers()
  })

  const cases: Array<[string, unknown[]]> = [
    ['add-label-to-task', [1, 2]],
    ['remove-label-from-task', [1, 2]],
    ['create-label', [{ title: 'x' }]],
    ['update-label', [2, { title: 'y' }]],
    ['delete-label', [2]],
    ['create-task-relation', [1, 2, 'subtask']],
    ['delete-task-relation', [1, 'subtask', 2]],
    ['upload-task-attachment', [1, new Uint8Array([1]), 'a.txt', 'text/plain']],
    ['delete-task-attachment', [1, 9]],
    ['create-project', [{ title: 'p' }]],
    ['update-project', [3, { title: 'p' }]],
    ['delete-project', [3]],
  ]

  it.each(cases)('%s tells Quick View to refresh when it succeeds', async (channel, args) => {
    await call(channel, ...args)
    expect(hoisted.send).toHaveBeenCalledWith('sync-completed')
  })

  it.each(cases)('%s leaves Quick View alone when it fails', async (channel, args) => {
    hoisted.result.current = { success: false, error: 'nope' }
    const result = await call(channel, ...args)
    expect(result).toEqual({ success: false, error: 'nope' })
    expect(hoisted.send).not.toHaveBeenCalled()
    expect(hoisted.invalidate).not.toHaveBeenCalled()
  })

  it.each(['create-project', 'update-project', 'delete-project'])('%s also drops the remembered project lists', async (channel) => {
    await call(channel, 3, { title: 'p' })
    expect(hoisted.invalidate).toHaveBeenCalledTimes(1)
  })

  it('pick-and-upload-attachment refreshes Quick View only when a file was uploaded', async () => {
    await call('pick-and-upload-attachment', 1)
    expect(hoisted.send).toHaveBeenCalledWith('sync-completed')

    hoisted.send.mockClear()
    hoisted.result.current = { success: false, error: 'too big' }
    expect(await call('pick-and-upload-attachment', 1)).toEqual({ success: false, error: 'too big' })
    expect(hoisted.send).not.toHaveBeenCalled()
  })

  it('returns the API result unchanged', async () => {
    hoisted.result.current = { success: true, data: { id: 5 } }
    expect(await call('add-label-to-task', 1, 2)).toEqual({ success: true, data: { id: 5 } })
  })
})
