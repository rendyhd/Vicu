import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  constructed: [] as unknown[],
  setBadgeCount: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
}))

vi.mock('electron', () => {
  class Notification {
    static isSupported(): boolean { return true }
    constructor(options: unknown) { electron.constructed.push(options) }
    show(): void { throw new Error('the registration notification must never be shown') }
  }
  return {
    app: { setBadgeCount: electron.setBadgeCount },
    nativeImage: { createFromDataURL: vi.fn() },
    shell: { openExternal: electron.openExternal },
    Notification,
  }
})
vi.mock('../platform', () => ({ isMac: true, isWindows: false, isLinux: false }))
vi.mock('../quick-entry-state', () => ({ getMainWindow: () => null }))

describe('the Dock badge on macOS', () => {
  beforeEach(() => {
    vi.resetModules()
    electron.constructed.length = 0
    electron.setBadgeCount.mockClear()
    electron.openExternal.mockClear()
  })

  it('registers for notifications once (never shown), because macOS badges only apps allowed to notify', async () => {
    const { setTaskBadge } = await import('../badge')
    setTaskBadge(3, 'data:image/png;base64,AAAA')
    setTaskBadge(4, 'data:image/png;base64,AAAAB')
    expect(electron.constructed).toHaveLength(1)
    expect(electron.setBadgeCount).toHaveBeenLastCalledWith(4)
  })

  it('does not register while there is nothing to count', async () => {
    const { setTaskBadge } = await import('../badge')
    setTaskBadge(0, null)
    expect(electron.constructed).toHaveLength(0)
    expect(electron.setBadgeCount).toHaveBeenCalledWith(0)
  })

  it('opens Vicu\'s page under System Settings, Notifications', async () => {
    const { openBadgeNotificationSettings } = await import('../badge')
    openBadgeNotificationSettings()
    expect(electron.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.rendyhd.vicu',
    )
  })
})
