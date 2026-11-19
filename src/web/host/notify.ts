// `@host/notify`, the web side: reminders as browser notifications while a Vicu tab is open, and
// inside the page when the browser will not show them (permission not given, or no Notification at
// all). The scheduler (src/main/notifications.ts) runs in the tab like it runs in the desktop's main
// process; this is how it speaks. Both hosts export the same names and types.

import { sendToAllWindows } from './windows'

/** What opens when a notification is clicked: a route, or a task. */
export interface NotificationTarget {
  route?: string
  taskId?: number
}

export interface NotificationRequest {
  title: string
  body: string
  /** No sound. */
  silent: boolean
  /** Stays on screen until dismissed. */
  persistent?: boolean
  /** One id per reminder: the browser replaces a notification with the same tag, and only one tab shows it. */
  tag: string
  /** For the log on the desktop; unused here. */
  context: string
  /** A click focuses the tab and opens the target. Left out: it only focuses the tab. */
  click?: NotificationTarget
}

/** A task kept on this computer (standalone mode); the web version has none. */
export interface StandaloneTaskInfo {
  id: number | string
  title: string
  due_date: string
}

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported'

/** How long the tab that took a reminder keeps its lock, so another tab's copy of it stays quiet. */
export const LOCK_HOLD_MS = 30_000

const ICON = '/icon.png'

/** The browser's permission for notifications. */
export function notificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported'
  const state = Notification.permission
  return state === 'granted' || state === 'denied' ? state : 'default'
}

/** Ask the user. Must be called from a click. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'unsupported'
  try {
    await Notification.requestPermission()
  } catch {
    // An old callback-style browser or a refused prompt: the state below says what happened.
  }
  return notificationPermission()
}

/** The same reminder shown inside the page. */
function showInPage(request: NotificationRequest): void {
  const notice: { title: string; body: string; taskId?: number; route?: string } = { title: request.title, body: request.body }
  if (request.click?.taskId !== undefined) notice.taskId = request.click.taskId
  if (request.click?.route !== undefined) notice.route = request.click.route
  sendToAllWindows('notifications:in-page', notice)
}

function showBrowserNotification(request: NotificationRequest): void {
  try {
    const notification = new Notification(request.title, {
      body: request.body,
      tag: request.tag,
      icon: ICON,
      silent: request.silent,
      requireInteraction: request.persistent === true,
    })
    notification.onclick = () => {
      try {
        window.focus()
        notification.close()
      } catch {
        // A tab that cannot be focused still gets the navigation below.
      }
      const target = request.click
      if (target?.route !== undefined) sendToAllWindows('navigate', target.route)
      if (target?.taskId !== undefined) sendToAllWindows('navigate-to-task', target.taskId)
    }
  } catch {
    // Some browsers refuse `new Notification` (Android Chrome wants a service worker): show it in the page.
    showInPage(request)
  }
}

/**
 * Show a notification. With permission it is a browser notification, and only one tab shows it: the
 * tab that takes the Web Lock named after the tag holds it for LOCK_HOLD_MS, the others show nothing.
 * Without permission (or without Notification) it is shown in the page, in every tab, because every
 * tab's page is where somebody may be looking.
 */
export function showNotification(request: NotificationRequest): void {
  if (notificationPermission() !== 'granted') {
    showInPage(request)
    return
  }
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) {
    showBrowserNotification(request)
    return
  }
  void locks.request(`vicu-notify:${request.tag}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return
    showBrowserNotification(request)
    await new Promise<void>((resolve) => setTimeout(resolve, LOCK_HOLD_MS))
  }).catch(() => showBrowserNotification(request))
}

/** The web version keeps no tasks on this computer. */
export function standaloneTasks(): StandaloneTaskInfo[] {
  return []
}

/** The web version has no offline queue, so nothing is closed here and unknown to the server. */
export function isTaskClosedLocally(_taskId: number): boolean {
  return false
}
