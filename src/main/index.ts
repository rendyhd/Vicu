import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen } from 'electron'
import { createMainWindow, createQuickEntryWindow, createQuickViewWindow } from './window-manager'
import { registerIpcHandlers } from './ipc-handlers'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { authManager } from './auth/auth-manager'
import { createTray, destroyTray, hasTray } from './tray'
import { returnFocusToPreviousWindow } from './focus'
import { registerQuickEntryState } from './quick-entry-state'

let mainWindow: BrowserWindow | null = null
let quickEntryWindow: BrowserWindow | null = null
let quickViewWindow: BrowserWindow | null = null

// Register shared state so ipc-handlers can access these without a circular import.
// The actual function bodies are defined below; the closures capture the module-level
// variables and will always reflect the current state when called.
registerQuickEntryState({
  getMainWindow: () => mainWindow,
  getQuickEntryWindow: () => quickEntryWindow,
  getQuickViewWindow: () => quickViewWindow,
  hideQuickEntry: () => hideQuickEntry(),
  hideQuickView: () => hideQuickView(),
  setViewerHeight: (h) => setViewerHeight(h),
  applyQuickEntrySettings: () => applyQuickEntrySettings(),
})

// --- Quick Entry/View constants ---
const SHADOW_PADDING = 20
const DRAG_HANDLE_HEIGHT = 14
let viewerDesiredHeight = 460 + DRAG_HANDLE_HEIGHT + SHADOW_PADDING * 2
let isResettingViewerHeight = false

// --- Drag hover polling ---
let dragHoverTimer: ReturnType<typeof setInterval> | null = null
let mainEntryDragHover = false
let viewerDragHover = false

function checkDragHover(win: BrowserWindow | null, prevHover: boolean): boolean {
  if (!win || win.isDestroyed() || !win.isVisible()) return prevHover
  const bounds = win.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const inRegion =
    cursor.x >= bounds.x + SHADOW_PADDING &&
    cursor.x < bounds.x + bounds.width - SHADOW_PADDING &&
    cursor.y >= bounds.y + SHADOW_PADDING &&
    cursor.y < bounds.y + SHADOW_PADDING + DRAG_HANDLE_HEIGHT
  if (inRegion !== prevHover) {
    try { win.webContents.send('drag-hover', inRegion) } catch { /* ignore */ }
  }
  return inRegion
}

function startDragHoverPolling(): void {
  if (dragHoverTimer) return
  dragHoverTimer = setInterval(() => {
    mainEntryDragHover = checkDragHover(quickEntryWindow, mainEntryDragHover)
    viewerDragHover = checkDragHover(quickViewWindow, viewerDragHover)
  }, 50)
}

function stopDragHoverPolling(): void {
  const entryVisible = quickEntryWindow && !quickEntryWindow.isDestroyed() && quickEntryWindow.isVisible()
  const viewerVisible = quickViewWindow && !quickViewWindow.isDestroyed() && quickViewWindow.isVisible()
  if (entryVisible || viewerVisible) return
  if (dragHoverTimer) {
    clearInterval(dragHoverTimer)
    dragHoverTimer = null
  }
  mainEntryDragHover = false
  viewerDragHover = false
}

// --- Blur debounce (prevents blur firing immediately after show on Windows) ---
let quickEntryShowTime = 0
let quickViewShowTime = 0
const BLUR_DEBOUNCE_MS = 300

// --- Quick Entry show/hide ---
function showQuickEntry(): void {
  if (!quickEntryWindow) return
  const config = loadConfig()

  if (config?.quick_entry_position) {
    const displays = screen.getAllDisplays()
    const pos = config.quick_entry_position
    const onScreen = displays.some((d) => {
      const bounds = d.workArea
      return pos.x >= bounds.x && pos.x < bounds.x + bounds.width &&
             pos.y >= bounds.y && pos.y < bounds.y + bounds.height
    })
    if (onScreen) {
      quickEntryWindow.setPosition(pos.x, pos.y)
    } else {
      centerQuickEntry()
    }
  } else {
    centerQuickEntry()
  }

  quickEntryWindow.show()
  quickEntryWindow.focus()
  quickEntryShowTime = Date.now()
  quickEntryWindow.webContents.send('window-shown')
  startDragHoverPolling()
}

function centerQuickEntry(): void {
  if (!quickEntryWindow) return
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const [winW] = quickEntryWindow.getSize()
  quickEntryWindow.setPosition(Math.round((sw - winW) / 2), Math.round(sh * 0.3))
}

function hideQuickEntry(): void {
  if (!quickEntryWindow) return
  quickEntryWindow.webContents.send('window-hidden')
  quickEntryWindow.hide()
  stopDragHoverPolling()
  returnFocusToPreviousWindow()
}

function toggleQuickEntry(): void {
  if (!quickEntryWindow) return
  if (quickEntryWindow.isVisible()) hideQuickEntry()
  else showQuickEntry()
}

// --- Quick View show/hide ---
function showQuickView(): void {
  if (!quickViewWindow) return
  const config = loadConfig()

  // Pre-size to desired height
  const [currentWidth] = quickViewWindow.getSize()
  isResettingViewerHeight = true
  quickViewWindow.setSize(currentWidth, viewerDesiredHeight)
  isResettingViewerHeight = false

  if (config?.quick_view_position) {
    const displays = screen.getAllDisplays()
    const pos = config.quick_view_position
    const onScreen = displays.some((d) => {
      const bounds = d.workArea
      return pos.x >= bounds.x && pos.x < bounds.x + bounds.width &&
             pos.y >= bounds.y && pos.y < bounds.y + bounds.height
    })
    if (onScreen) {
      quickViewWindow.setPosition(pos.x, pos.y)
    } else {
      centerQuickView()
    }
  } else {
    centerQuickView()
  }

  quickViewWindow.show()
  quickViewWindow.focus()
  quickViewShowTime = Date.now()
  quickViewWindow.webContents.send('viewer-shown')
  startDragHoverPolling()
}

function centerQuickView(): void {
  if (!quickViewWindow) return
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize
  const [winW] = quickViewWindow.getSize()
  quickViewWindow.setPosition(Math.round((sw - winW) / 2), Math.round(sh * 0.2))
}

function hideQuickView(): void {
  if (!quickViewWindow) return
  quickViewWindow.hide()
  stopDragHoverPolling()
  returnFocusToPreviousWindow()
}

function toggleQuickView(): void {
  if (!quickViewWindow) return
  if (quickViewWindow.isVisible()) hideQuickView()
  else showQuickView()
}

// --- Viewer height management ---
function setViewerHeight(height: number): void {
  if (!quickViewWindow || quickViewWindow.isDestroyed()) return
  const clamped = Math.max(60, Math.min(460 + DRAG_HANDLE_HEIGHT, Math.round(height))) + SHADOW_PADDING * 2
  viewerDesiredHeight = clamped
  if (!quickViewWindow.isVisible()) return
  const [currentWidth] = quickViewWindow.getSize()
  isResettingViewerHeight = true
  quickViewWindow.setSize(currentWidth, clamped)
  isResettingViewerHeight = false
}

// --- Shortcut registration ---
function registerQuickEntryShortcuts(config: AppConfig): { entry: boolean; viewer: boolean } {
  const result = { entry: false, viewer: false }

  const entryHotkey = config.quick_entry_hotkey || 'Alt+Shift+V'
  try {
    result.entry = globalShortcut.register(entryHotkey, toggleQuickEntry)
    if (!result.entry) console.error(`Failed to register Quick Entry shortcut: ${entryHotkey}`)
  } catch (err) {
    console.error(`Error registering entry shortcut "${entryHotkey}":`, err)
  }

  const viewerHotkey = config.quick_view_hotkey || 'Alt+Shift+B'
  try {
    result.viewer = globalShortcut.register(viewerHotkey, toggleQuickView)
    if (!result.viewer) console.error(`Failed to register Quick View shortcut: ${viewerHotkey}`)
  } catch (err) {
    console.error(`Error registering viewer shortcut "${viewerHotkey}":`, err)
  }

  return result
}

// --- Tray setup ---
function setupTray(): void {
  if (hasTray()) return
  createTray({
    onShowMainWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
      }
    },
    onShowQuickEntry: () => showQuickEntry(),
    onShowQuickView: () => showQuickView(),
    onQuit: () => {
      app.isQuitting = true
      app.quit()
    },
  })
}

// --- Quick Entry/View initialization ---
function initQuickEntryWindows(config: AppConfig): void {
  if (!quickEntryWindow) {
    quickEntryWindow = createQuickEntryWindow(config)
    quickEntryWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault()
        hideQuickEntry()
      }
    })
    quickEntryWindow.on('blur', () => {
      if (quickEntryWindow?.isVisible() && Date.now() - quickEntryShowTime > BLUR_DEBOUNCE_MS) {
        hideQuickEntry()
      }
    })
    quickEntryWindow.on('moved', () => {
      if (!quickEntryWindow) return
      const [x, y] = quickEntryWindow.getPosition()
      const current = loadConfig()
      if (current) {
        current.quick_entry_position = { x, y }
        saveConfig(current)
      }
    })
  }

  if (!quickViewWindow) {
    quickViewWindow = createQuickViewWindow(config)
    quickViewWindow.on('close', (e) => {
      if (!app.isQuitting) {
        e.preventDefault()
        hideQuickView()
      }
    })
    quickViewWindow.on('blur', () => {
      if (quickViewWindow?.isVisible() && Date.now() - quickViewShowTime > BLUR_DEBOUNCE_MS) {
        hideQuickView()
      }
    })
    quickViewWindow.on('moved', () => {
      if (!quickViewWindow) return
      const [x, y] = quickViewWindow.getPosition()
      const current = loadConfig()
      if (current) {
        current.quick_view_position = { x, y }
        saveConfig(current)
      }
    })
    // Lock height to desired value
    quickViewWindow.on('resize', () => {
      if (isResettingViewerHeight || !quickViewWindow) return
      const [w, h] = quickViewWindow.getSize()
      if (h !== viewerDesiredHeight) {
        isResettingViewerHeight = true
        quickViewWindow.setSize(w, viewerDesiredHeight)
        isResettingViewerHeight = false
      }
    })
  }
}

// Apply quick entry settings (called from IPC when settings change)
function applyQuickEntrySettings(): { entry: boolean; viewer: boolean } {
  const config = loadConfig()
  if (!config) return { entry: false, viewer: false }

  // Unregister existing shortcuts
  globalShortcut.unregisterAll()

  if (config.quick_entry_enabled) {
    setupTray()
    initQuickEntryWindows(config)
    const result = registerQuickEntryShortcuts(config)

    app.setLoginItemSettings({ openAtLogin: config.launch_on_startup === true })
    return result
  } else {
    // Clean up quick entry windows and tray
    if (quickEntryWindow && !quickEntryWindow.isDestroyed()) {
      quickEntryWindow.destroy()
      quickEntryWindow = null
    }
    if (quickViewWindow && !quickViewWindow.isDestroyed()) {
      quickViewWindow.destroy()
      quickViewWindow = null
    }
    destroyTray()
    if (dragHoverTimer) {
      clearInterval(dragHoverTimer)
      dragHoverTimer = null
    }
  }

  app.setLoginItemSettings({ openAtLogin: config.launch_on_startup === true })
  return { entry: false, viewer: false }
}

// Augment the app type
declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}

// Single instance lock — quit if another instance is already running
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerIpcHandlers()
    await authManager.initialize()

    const config = loadConfig()
    mainWindow = createMainWindow(config)

    // Window control IPC handlers
    ipcMain.handle('window-minimize', () => mainWindow?.minimize())
    ipcMain.handle('window-maximize', () => {
      if (mainWindow?.isMaximized()) mainWindow.unmaximize()
      else mainWindow?.maximize()
    })
    ipcMain.handle('window-close', () => mainWindow?.close())
    ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() ?? false)

    mainWindow.on('maximize', () => mainWindow?.webContents.send('window-maximized-change', true))
    mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window-maximized-change', false))

    // Save window bounds on move/resize
    const saveBounds = (): void => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const bounds = mainWindow.getBounds()
      const current = loadConfig()
      if (current) {
        current.window_bounds = bounds
        saveConfig(current)
      }
    }

    mainWindow.on('moved', saveBounds)
    mainWindow.on('resized', saveBounds)

    // Open DevTools in development
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Quick Entry: if enabled, set up tray + windows + hotkeys
    if (config?.quick_entry_enabled) {
      setupTray()
      initQuickEntryWindows(config)
      globalShortcut.unregisterAll() // Clear stale registrations from crashes
      registerQuickEntryShortcuts(config)
      app.setLoginItemSettings({ openAtLogin: config.launch_on_startup === true })

      // When QE is enabled, hide main window on close instead of quitting
      mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
          e.preventDefault()
          mainWindow?.hide()
        }
      })
    }
  })

  app.on('window-all-closed', () => {
    // Don't quit if tray is active (Quick Entry enabled)
    if (!hasTray()) {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (dragHoverTimer) {
      clearInterval(dragHoverTimer)
      dragHoverTimer = null
    }
    destroyTray()
  })
}
