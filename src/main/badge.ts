import { app, nativeImage, Notification, shell } from 'electron'
import { isMac, isWindows } from './platform'
import { APP_ID } from './app-id'
import { getMainWindow } from './quick-entry-state'

let lastKey = ''
let lastCount = 0
let lastDataUrl: string | null = null

let macNotificationsRegistered = false

/**
 * macOS draws a Dock badge only for an app that may show notifications with badges. Electron asks
 * for that permission (alert, sound and badge) when its notification presenter is made, which is
 * the first time a Notification is constructed; until then Vicu is not listed under System
 * Settings, Notifications, and the count never shows, for example with reminders off. Constructing
 * one (never shown) makes the presenter and asks once.
 */
function registerMacNotifications(): void {
  if (macNotificationsRegistered) return
  macNotificationsRegistered = true
  try {
    if (Notification.isSupported()) new Notification({ title: 'Vicu', silent: true }) // i18n-ignore: never shown, registers the Dock badge
  } catch (err) {
    console.warn('Could not register for notifications (Dock badge):', err)
  }
}

/** System Settings, Notifications, Vicu: where macOS keeps "Badge application icon". */
export function openBadgeNotificationSettings(): void {
  if (!isMac) return
  void shell.openExternal(`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=${APP_ID}`)
}

function labelFor(count: number): string {
  if (count >= 100) return '99+'
  return String(count)
}

function paintWindowsOverlay(count: number, dataUrl: string | null): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (count === 0 || !dataUrl) {
    win.setOverlayIcon(null, '')
    return
  }
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) {
    win.setOverlayIcon(null, '')
    return
  }
  win.setOverlayIcon(image, `${labelFor(count)} task${count === 1 ? '' : 's'} due`)
}

export function setTaskBadge(count: number, dataUrl: string | null): void {
  if (count < 0) count = 0
  const key = `${count}|${dataUrl?.length ?? 0}`
  if (key === lastKey) return
  lastKey = key
  lastCount = count
  lastDataUrl = dataUrl

  if (count === 0) {
    clearTaskBadge()
    return
  }

  if (isMac) {
    registerMacNotifications()
    app.setBadgeCount(count)
    return
  }

  if (isWindows) {
    paintWindowsOverlay(count, dataUrl)
    return
  }

  app.setBadgeCount(count)
}

export function clearTaskBadge(): void {
  lastKey = '0|0'
  lastCount = 0
  lastDataUrl = null

  if (isMac) {
    app.setBadgeCount(0)
    return
  }

  if (isWindows) {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.setOverlayIcon(null, '')
    return
  }

  app.setBadgeCount(0)
}

// Windows drops the taskbar overlay when the main window is hidden and
// re-shown (the taskbar button is destroyed and recreated). Call this from
// the window's 'show' event to repaint using the most recent state.
export function reapplyTaskBadge(): void {
  if (!isWindows) return
  if (lastCount === 0 || !lastDataUrl) return
  paintWindowsOverlay(lastCount, lastDataUrl)
}
