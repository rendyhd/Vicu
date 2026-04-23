import { app, nativeImage } from 'electron'
import { isMac, isWindows } from './platform'
import { getMainWindow } from './quick-entry-state'

let lastKey = ''
let lastCount = 0
let lastDataUrl: string | null = null

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
