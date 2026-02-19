import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'

let tray: Tray | null = null

export interface TrayCallbacks {
  onShowMainWindow: () => void
  onShowQuickEntry: () => void
  onShowQuickView: () => void
  onQuit: () => void
}

let callbacks: TrayCallbacks | null = null

function createTrayIcon(): Electron.NativeImage {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
  try {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) {
      return icon.resize({ width: 16, height: 16 })
    }
  } catch {
    // fall through to programmatic icon
  }

  // Fallback: generate a 16x16 "V" checkmark icon programmatically
  const size = 16
  const buf = Buffer.alloc(size * size * 4, 0)

  const pixels = [
    [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
    [3, 3], [4, 4], [5, 5], [6, 6], [7, 7],
    [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
    [8, 8], [9, 9], [10, 10], [11, 11], [12, 12], [13, 11],
    [7, 9], [8, 10],
  ]

  for (const [y, x] of pixels) {
    const offset = (y * size + x) * 4
    buf[offset] = 100     // R
    buf[offset + 1] = 149 // G
    buf[offset + 2] = 237 // B
    buf[offset + 3] = 255 // A
  }

  return nativeImage.createFromBuffer(buf, { width: size, height: size })
}

export function createTray(cbs: TrayCallbacks): void {
  if (tray) return
  callbacks = cbs

  const icon = createTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('Vicu')
  updateTrayMenu()

  tray.on('click', () => {
    callbacks?.onShowMainWindow()
  })
}

export function updateTrayMenu(): void {
  if (!tray || !callbacks) return

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Vicu', click: () => callbacks!.onShowMainWindow() },
    { label: 'Quick Entry', click: () => callbacks!.onShowQuickEntry() },
    { label: 'Quick View', click: () => callbacks!.onShowQuickView() },
    { type: 'separator' },
    { label: 'Quit', click: () => callbacks!.onQuit() },
  ])

  tray.setContextMenu(contextMenu)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
  callbacks = null
}

export function hasTray(): boolean {
  return tray !== null
}
