import { BrowserWindow, session } from 'electron'
import { join } from 'path'
import type { AppConfig } from './config'

const SHADOW_PADDING = 20
const DRAG_HANDLE_HEIGHT = 14

export function createMainWindow(config: AppConfig | null): BrowserWindow {
  const bounds = config?.window_bounds

  const win = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 720,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Set CSP header (relaxed in dev for Vite HMR)
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
          ],
        },
      })
    })
  }

  // Show window once ready to avoid flash
  win.once('ready-to-show', () => {
    win.show()
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
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-entry.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

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
    minWidth: 300 + SHADOW_PADDING * 2,
    maxWidth: 800 + SHADOW_PADDING * 2,
    minHeight: 60 + SHADOW_PADDING * 2,
    maxHeight: 460 + DRAG_HANDLE_HEIGHT + SHADOW_PADDING * 2,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/quick-view.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/quick-view/index.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/quick-view/index.html'))
  }

  return win
}
