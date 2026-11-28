// `@host/notify`, the Electron side: desktop notifications, the app icon, bringing the main window
// forward and the two data sources only the desktop has (standalone tasks, the offline queue). The
// reminder scheduler (src/main/notifications.ts) decides what to say and when; this says it. The web
// build swaps this module for src/web/host/notify.ts. Both export the same names and types.

import { app, Notification, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'path'
import { getAllStandaloneTasks } from '../cache'
import { getOfflineQueue } from '../offline/service'

/** What opens when a notification is clicked: a route, or a task. Both left out: the app only comes forward. */
export interface NotificationTarget {
  route?: string
  taskId?: number
}

export interface NotificationRequest {
  title: string
  body: string
  /** No sound. */
  silent: boolean
  /** Stays on screen until dismissed. Left out: the system's default (the plan nudge). */
  persistent?: boolean
  /** One id per reminder, so a host that can show the same reminder twice shows it once. */
  tag: string
  /** For the log when the system refuses the notification. */
  context: string
  /** Present: a click brings the app forward and opens the target. Left out: a click does nothing. */
  click?: NotificationTarget
}

/** A task kept on this computer (standalone mode). */
export interface StandaloneTaskInfo {
  id: number | string
  title: string
  due_date: string
}

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported'

// Reference to the main window (set during init)
let mainWindowRef: BrowserWindow | null = null

/** Set or update the main-window ref (also after a recreation, without rescheduling timers). */
export function setNotificationsMainWindow(mainWindow: BrowserWindow | null): void {
  mainWindowRef = mainWindow
}

function showMainWindow(): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.show()
    if (mainWindowRef.isMinimized()) mainWindowRef.restore()
    mainWindowRef.focus()
  }
}

function getIcon(): Electron.NativeImage | undefined {
  try {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'resources', 'icon.png')
      : join(app.getAppPath(), 'resources', 'icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    return icon.isEmpty() ? undefined : icon
  } catch {
    return undefined
  }
}

/**
 * Attach failure logging for desktop notifications. On macOS, Electron 42+
 * uses UNNotification which requires a code-signed app — unsigned/dev builds
 * emit `failed` instead of showing the notification.
 */
function attachNotificationDiagnostics(notification: Notification, context: string): void {
  notification.on('failed', (_event, error) => {
    console.warn(`[Notifications] ${context} failed:`, error)
  })
}

/** Show a notification. */
export function showNotification(request: NotificationRequest): void {
  const notification = new Notification({
    title: request.title,
    body: request.body,
    silent: request.silent,
    ...(request.persistent === undefined ? {} : { timeoutType: request.persistent ? 'never' : 'default' }),
    icon: getIcon(),
  })
  attachNotificationDiagnostics(notification, request.context)
  const target = request.click
  if (target) {
    notification.on('click', () => {
      showMainWindow()
      if (target.route !== undefined) mainWindowRef?.webContents.send('navigate', target.route)
      if (target.taskId !== undefined) mainWindowRef?.webContents.send('navigate-to-task', target.taskId)
    })
  }
  notification.show()
}

/** Tasks kept on this computer without a server. */
export function standaloneTasks(): StandaloneTaskInfo[] {
  return getAllStandaloneTasks()
}

/** The user completed or deleted the task here and the offline queue has not told the server yet. */
export function isTaskClosedLocally(taskId: number): boolean {
  try {
    return getOfflineQueue().getPending().some((action) =>
      (action.type === 'delete' && action.taskId === taskId) ||
      (action.type === 'update' && action.taskId === taskId && action.patch.done === true)
    )
  } catch {
    return false
  }
}

/** The desktop needs no permission from the user. */
export function notificationPermission(): NotificationPermission {
  return 'granted'
}

export function requestNotificationPermission(): Promise<NotificationPermission> {
  return Promise.resolve('granted')
}
