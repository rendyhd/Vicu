import { beforeEach, describe, expect, it, vi } from 'vitest'

// IPC handlers that act on the windows or the notification scheduler:
// - "Open in app" from Quick View: main raises the main window and tells it which task to show
//   (channel navigate-to-task, which the preload exposes as onNavigateToTask, F5).
// - The reminder refresh every changed task asks for is collapsed into one (F8).

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  viewerSend: vi.fn(),
  mainSend: vi.fn(),
  hideQuickView: vi.fn(),
  refreshTaskRemindersSoon: vi.fn(),
  forgetDeletedTask: vi.fn(),
  replay: vi.fn(async () => null),
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
  queue: {},
  mainWindow: { current: null as null | Record<string, unknown> },
}))

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
  const entries = Object.fromEntries(['updateTask', 'deleteTask', 'addLabelToTask', 'removeLabelFromTask'].map((name) => {
    const fn = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ success: true, data: { id: 5 } }))
    hoisted.api[name] = fn
    return [name, fn]
  }))
  return { ...entries, checkUploadSize: vi.fn() }
})
vi.mock('../quick-entry-state', () => ({
  getQuickViewWindow: () => ({ isDestroyed: () => false, webContents: { send: hoisted.viewerSend } }),
  getMainWindow: () => hoisted.mainWindow.current,
  hideQuickView: () => hoisted.hideQuickView(),
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
vi.mock('../notifications', () => ({ refreshTaskRemindersSoon: hoisted.refreshTaskRemindersSoon }))
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

function fakeMainWindow() {
  return {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { id: 1, send: hoisted.mainSend },
  }
}

describe('qv:open-task-in-app', () => {
  beforeEach(() => {
    hoisted.handlers.clear()
    hoisted.mainSend.mockClear()
    hoisted.hideQuickView.mockClear()
    hoisted.mainWindow.current = fakeMainWindow()
    registerIpcHandlers()
  })

  it('raises the main window, tells it which task to show and closes Quick View', async () => {
    const win = hoisted.mainWindow.current as ReturnType<typeof fakeMainWindow>

    await call('qv:open-task-in-app', 42)

    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(hoisted.mainSend).toHaveBeenCalledWith('navigate-to-task', 42)
    expect(hoisted.hideQuickView).toHaveBeenCalled()
  })

  it.each([0, -2, 1.5, '42', null, undefined])('does nothing for an id that is not a task on the server: %s', async (bad) => {
    await call('qv:open-task-in-app', bad)
    expect(hoisted.mainSend).not.toHaveBeenCalled()
    expect(hoisted.hideQuickView).not.toHaveBeenCalled()
  })

  it('does nothing when the main window is gone', async () => {
    hoisted.mainWindow.current = null
    await call('qv:open-task-in-app', 42)
    expect(hoisted.mainSend).not.toHaveBeenCalled()
  })
})

describe('notifications:refresh-task-reminders', () => {
  beforeEach(() => {
    hoisted.handlers.clear()
    hoisted.refreshTaskRemindersSoon.mockClear()
    registerIpcHandlers()
  })

  it('asks for the debounced refresh, once per call, so main can collapse a burst into one request', async () => {
    for (let i = 0; i < 5; i++) await call('notifications:refresh-task-reminders')
    expect(hoisted.refreshTaskRemindersSoon).toHaveBeenCalledTimes(5)
  })
})
