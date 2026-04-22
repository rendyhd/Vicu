import { app, nativeImage } from 'electron'
import { isMac, isWindows } from './platform'
import { getMainWindow } from './quick-entry-state'

let lastKey = ''

function labelFor(count: number): string {
  if (count >= 100) return '99+'
  return String(count)
}

export function setTaskBadge(count: number, dataUrl: string | null): void {
  if (count < 0) count = 0
  const key = `${count}|${dataUrl?.length ?? 0}`
  if (key === lastKey) return
  lastKey = key

  if (count === 0) {
    clearTaskBadge()
    return
  }

  if (isMac) {
    app.setBadgeCount(count)
    return
  }

  if (isWindows) {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    if (!dataUrl) {
      win.setOverlayIcon(null, '')
      return
    }
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      win.setOverlayIcon(null, '')
      return
    }
    win.setOverlayIcon(image, `${labelFor(count)} task${count === 1 ? '' : 's'} due`)
    return
  }

  app.setBadgeCount(count)
}

export function clearTaskBadge(): void {
  lastKey = '0|0'

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
