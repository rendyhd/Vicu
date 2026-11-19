import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listen } from '../host/windows'
import { LOCK_HOLD_MS, notificationPermission, requestNotificationPermission, showNotification } from '../host/notify'

// The web host's notifications: browser notification when allowed (one tab per reminder), the
// page's own toast otherwise. Browser globals are stubbed; vitest runs in Node.

const shown: Array<{ title: string; options: Record<string, unknown>; onclick?: () => void; close: () => void }> = []

class FakeNotification {
  static permission: string = 'granted'
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = 'granted'
    return 'granted'
  })
  onclick?: () => void
  close = vi.fn()
  constructor(public title: string, public options: Record<string, unknown>) {
    shown.push(this as never)
  }
}

const request = { title: 'Reminder: Pay', body: 'Task reminder', silent: false, tag: 'task:5', context: 'x', click: { taskId: 5 } }

function stubWindow(): ReturnType<typeof vi.fn> {
  const focus = vi.fn()
  vi.stubGlobal('window', { focus })
  return focus
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('web notify', () => {
  beforeEach(() => {
    shown.length = 0
    FakeNotification.permission = 'granted'
    vi.stubGlobal('Notification', FakeNotification)
    vi.stubGlobal('navigator', {})
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reads the permission, and says unsupported without Notification', () => {
    expect(notificationPermission()).toBe('granted')
    FakeNotification.permission = 'default'
    expect(notificationPermission()).toBe('default')
    vi.stubGlobal('Notification', undefined)
    expect(notificationPermission()).toBe('unsupported')
  })

  it('asks for the permission and answers the new state', async () => {
    FakeNotification.permission = 'default'
    expect(await requestNotificationPermission()).toBe('granted')
  })

  it('shows a browser notification with the tag and focuses and navigates on click', async () => {
    const focus = stubWindow()
    const navigated: unknown[] = []
    const off = listen('navigate-to-task', (id) => navigated.push(id))
    showNotification(request)
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toBe('Reminder: Pay')
    expect(shown[0].options).toMatchObject({ body: 'Task reminder', tag: 'task:5', icon: '/icon.png', silent: false, requireInteraction: false })
    shown[0].onclick?.()
    await flush()
    expect(focus).toHaveBeenCalled()
    expect(navigated).toEqual([5])
    off()
  })

  it('shows it in the page when permission is not granted', async () => {
    FakeNotification.permission = 'denied'
    const notices: unknown[] = []
    const off = listen('notifications:in-page', (notice) => notices.push(notice))
    showNotification(request)
    await flush()
    expect(shown).toHaveLength(0)
    expect(notices).toEqual([{ title: 'Reminder: Pay', body: 'Task reminder', taskId: 5 }])
    off()
  })

  it('lets only the tab that takes the lock show the reminder', async () => {
    const held = new Set<string>()
    const release: Array<() => void> = []
    vi.stubGlobal('navigator', {
      locks: {
        request: (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
          if (held.has(name)) return callback(null)
          held.add(name)
          return callback({}).then(() => { held.delete(name); release.push(() => undefined) })
        },
      },
    })
    showNotification(request)
    showNotification(request)
    await flush()
    expect(shown).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(LOCK_HOLD_MS)
    showNotification(request)
    await flush()
    expect(shown).toHaveLength(2)
  })
})
