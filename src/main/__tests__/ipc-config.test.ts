import { beforeEach, describe, expect, it, vi } from 'vitest'

// The config write channels (save-config-patch, save-connection-config) register through the real
// ipc-handlers module; the config module is real except where it reads and writes the disk.

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  config: { current: null as Record<string, unknown> | null },
  saveConfig: vi.fn(),
  storeAPIToken: vi.fn(),
  accountChanged: vi.fn(),
  replay: vi.fn(async () => null),
  viewerSend: vi.fn(),
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
vi.mock('../api-client', () => ({ checkUploadSize: vi.fn() }))
vi.mock('../quick-entry-state', () => ({
  getQuickViewWindow: () => ({ isDestroyed: () => false, webContents: { send: hoisted.viewerSend } }),
  getMainWindow: () => null,
}))
vi.mock('../quick-entry/viewer-caches', () => ({ invalidateViewerCaches: () => undefined, activeProjects: {}, projectListViewIds: {} }))
vi.mock('../offline/ipc', () => ({ registerOfflineQueueIpc: () => undefined }))
vi.mock('../offline/service', () => ({ getOfflineQueue: () => ({}), rememberKnownUser: () => undefined }))
vi.mock('../offline/quick-actions', () => ({}))
vi.mock('../sync', () => ({ accountChanged: hoisted.accountChanged, replayPendingActions: hoisted.replay }))
vi.mock('../carrier-service', () => ({ forgetDeletedTask: () => undefined, loadRoutineCarriers: async () => ({ success: true, data: [] }), rememberCreatedTask: () => undefined }))
vi.mock('../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config')>()
  return {
    ...actual,
    loadConfig: () => (hoisted.config.current ? structuredClone(hoisted.config.current) : null),
    saveConfig: hoisted.saveConfig,
  }
})
vi.mock('../custom-list-service', () => ({ syncCustomLists: async () => undefined }))
vi.mock('../auth/oidc-discovery', () => ({}))
vi.mock('../auth/user-info', () => ({}))
vi.mock('../auth/auth-manager', () => ({ authManager: {} }))
vi.mock('../auth/oidc-login', () => ({ OidcTotpRequiredError: class extends Error {} }))
vi.mock('../auth/token-store', () => ({ API_TOKEN_NO_EXPIRY: 0, storeAPIToken: hoisted.storeAPIToken }))
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
  return handler({ sender: { id: 1 } }, ...args)
}

const baseConfig = () => ({
  vikunja_url: 'https://tasks.example.com',
  api_token: '',
  auth_method: 'api_token',
  inbox_project_id: 5,
  theme: 'dark',
  sidebar_width: 250,
  last_used_project_id: 9,
})

describe('config writes over IPC', () => {
  beforeEach(() => {
    hoisted.handlers.clear()
    for (const fn of [hoisted.saveConfig, hoisted.storeAPIToken, hoisted.accountChanged, hoisted.replay, hoisted.viewerSend]) fn.mockReset()
    hoisted.replay.mockResolvedValue(null)
    hoisted.config.current = baseConfig()
    registerIpcHandlers()
  })

  describe('save-config-patch', () => {
    it('merges the patch into the current config and saves it', async () => {
      await call('save-config-patch', { sidebar_width: 321 })

      expect(hoisted.saveConfig).toHaveBeenCalledTimes(1)
      expect(hoisted.saveConfig.mock.calls[0][0]).toMatchObject({ vikunja_url: 'https://tasks.example.com', sidebar_width: 321, inbox_project_id: 5 })
    })

    it('rejects when the config cannot be written, so Settings can say so instead of showing "saved" (F2)', async () => {
      hoisted.saveConfig.mockImplementation(() => {
        throw new Error('EPERM: operation not permitted, rename')
      })

      await expect(call('save-config-patch', { theme: 'light' })).rejects.toThrow(/EPERM/)
    })

    it('rejects a patch that is not an object', async () => {
      await expect(call('save-config-patch', null)).rejects.toThrow(/Invalid config patch/)
      await expect(call('save-config-patch', [1])).rejects.toThrow(/Invalid config patch/)
      expect(hoisted.saveConfig).not.toHaveBeenCalled()
    })
  })
})
