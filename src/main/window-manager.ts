import { BrowserWindow, nativeTheme, screen, session } from 'electron'
import { release } from 'os'
import { join } from 'path'
import type { AppConfig } from './config'
import { isMac, isLinux, isWindows } from './platform'
import {
  isDarkChrome,
  titleBandOverlay,
  windowChromeOptions,
  windowMaterialFor,
  windowsBuildFromRelease,
  type ChromePlatform,
} from './window-chrome'

const SHADOW_PADDING = 20
const DRAG_HANDLE_HEIGHT = 14
const MIN_VISIBLE_PX = 100

function boundsAreVisible(bounds: NonNullable<AppConfig['window_bounds']>): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, wa.x + wa.width) - Math.max(bounds.x, wa.x))
    const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, wa.y + wa.height) - Math.max(bounds.y, wa.y))
    return overlapX >= MIN_VISIBLE_PX && overlapY >= MIN_VISIBLE_PX
  })
}

export function createMainWindow(config: AppConfig | null, options: { startHidden?: boolean } = {}): BrowserWindow {
  const saved = config?.window_bounds
  const bounds = saved && boundsAreVisible(saved) ? saved : undefined

  // First-launch safety: compute an explicit centered position from the primary
  // display's work area when no bounds are saved. Wayland compositors cannot
  // let clients self-position; passing undefined x/y for a frameless window can
  // trigger a maximize on mutter, which is why Linux first-launches looked
  // fullscreen before this fix.
  const defaultWidth = bounds?.width ?? 1100
  const defaultHeight = bounds?.height ?? 720
  const workArea = screen.getPrimaryDisplay().workArea
  const centeredX = workArea.x + Math.max(0, Math.round((workArea.width - defaultWidth) / 2))
  const centeredY = workArea.y + Math.max(0, Math.round((workArea.height - defaultHeight) / 2))
  const fallbackX = bounds?.x ?? centeredX
  const fallbackY = bounds?.y ?? centeredY

  const chromePlatform: ChromePlatform = isMac ? 'darwin' : isWindows ? 'win32' : 'linux'
  const windowsBuild = isWindows ? windowsBuildFromRelease(release()) : 0
  const material = windowMaterialFor(chromePlatform, windowsBuild)

  const win = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    x: fallbackX,
    y: fallbackY,
    minWidth: 800,
    minHeight: 500,
    ...windowChromeOptions({ platform: chromePlatform, windowsBuild, dark: isDarkChrome(config?.theme, nativeTheme.shouldUseDarkColors) }),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer makes its sidebar translucent only when the window has Mica behind it.
      additionalArguments: [`--vicu-window-material=${material}`],
    },
  })

  // The native caption buttons follow the theme (a chosen theme or the system's): the colours of
  // the title band are the page background and secondary text of the token contract.
  if (isWindows) {
    const updateOverlay = (): void => {
      if (win.isDestroyed()) return
      win.setTitleBarOverlay(titleBandOverlay(nativeTheme.shouldUseDarkColors))
    }
    nativeTheme.on('updated', updateOverlay)
    win.once('closed', () => nativeTheme.removeListener('updated', updateOverlay))
  }

  // Set CSP header (relaxed in dev for Vite HMR)
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; media-src 'self' blob:",
          ],
        },
      })
    })
  }

  // Show window once ready to avoid flash.
  // On Linux (Wayland/mutter in particular) frameless xdg_toplevels without
  // server-side decorations get auto-maximized by the compositor when first
  // mapped. Explicitly unmaximize and force the bounds we asked for.
  const fixLinuxBounds = (): void => {
    if (!isLinux) return
    if (win.isMaximized()) win.unmaximize()
    win.setBounds({
      x: fallbackX,
      y: fallbackY,
      width: defaultWidth,
      height: defaultHeight,
    })
  }
  win.once('ready-to-show', () => {
    if (options.startHidden) {
      // Launched at login into the tray: stay hidden. The first show comes later (tray, dock or a
      // second launch) and gets the same Linux bounds fix then.
      win.once('show', fixLinuxBounds)
      return
    }
    win.show()
    fixLinuxBounds()
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function createQuickEntryWindow(_config: AppConfig | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 560 + SHADOW_PADDING * 2,
    height: 260 + SHADOW_PADDING * 2,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    roundedCorners: false,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-entry.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  // Ensure no traffic lights appear on this frameless popup on macOS
  if (isMac) {
    win.setWindowButtonVisibility(false)
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-entry/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/quick-entry/index.html'))
  }

  return win
}

export function createQuickViewWindow(_config: AppConfig | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 420 + SHADOW_PADDING * 2,
    height: 460 + DRAG_HANDLE_HEIGHT + SHADOW_PADDING * 2,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    roundedCorners: false,
    minWidth: 300 + SHADOW_PADDING * 2,
    maxWidth: 800 + SHADOW_PADDING * 2,
    minHeight: 60 + SHADOW_PADDING * 2,
    maxHeight: 460 + DRAG_HANDLE_HEIGHT + SHADOW_PADDING * 2,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  // Ensure no traffic lights appear on this frameless popup on macOS
  if (isMac) {
    win.setWindowButtonVisibility(false)
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-view/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/quick-view/index.html'))
  }

  return win
}
