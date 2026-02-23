import { app, BrowserWindow, globalShortcut, ipcMain, Menu, powerMonitor, screen } from 'electron'
import { createMainWindow, createQuickEntryWindow, createQuickViewWindow } from './window-manager'
import { registerIpcHandlers } from './ipc-handlers'
import { loadConfig, saveConfig, type AppConfig } from './config'
import { authManager } from './auth/auth-manager'
import { createTray, destroyTray, hasTray } from './tray'
import { returnFocusToPreviousWindow } from './focus'
import { registerQuickEntryState } from './quick-entry-state'
import { initNotifications, rescheduleNotifications, stopNotifications } from './notifications'
import { getObsidianContext, getForegroundProcessName, isObsidianForeground, type ObsidianNoteContext } from './obsidian-client'
import { getBrowserContext, type BrowserContext } from './browser-client'
import { getBrowserUrlFromWindow, prewarmUrlReader, shutdownUrlReader, BROWSER_PROCESSES } from './window-url-reader'
import { isRegistered, unregisterHosts } from './browser-host-registration'
import { checkForUpdates } from './update-checker'
import { isMac, isWindows } from './platform'

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
async function showQuickEntry(): Promise<void> {
  if (!quickEntryWindow) return
  const config = loadConfig()

  // Obsidian detection — check foreground window instantly (koffi FFI, ~1μs),
  // then fetch context only if Obsidian is actually focused
  let obsidianContext: ObsidianNoteContext | null = null
  if (config?.obsidian_mode && config.obsidian_mode !== 'off' && config.obsidian_api_key && isObsidianForeground()) {
    obsidianContext = await Promise.race([
      getObsidianContext(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 350))
    ])
  }

  // Browser tab detection — only if Obsidian didn't match
  let browserContext: BrowserContext | null = null
  if (!obsidianContext && config?.browser_link_mode && config.browser_link_mode !== 'off') {
    browserContext = getBrowserContext() // extension path (<1ms)
    if (!browserContext) {
      // Fallback: read URL bar directly via Windows UI Automation
      const fgProcess = getForegroundProcessName()
      if (BROWSER_PROCESSES.has(fgProcess)) {
        browserContext = await Promise.race([
          getBrowserUrlFromWindow(fgProcess),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 1500))
        ])
      }
    }
  }

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

  // Send Obsidian context BEFORE window-shown so renderer sets up UI before animating in
  if (obsidianContext && config?.obsidian_mode) {
    quickEntryWindow.webContents.send('obsidian-context', {
      ...obsidianContext,
      mode: config.obsidian_mode,
    })
  }

  // Send browser context if available (Obsidian takes priority)
  if (!obsidianContext && browserContext && config?.browser_link_mode) {
    quickEntryWindow.webContents.send('browser-context', {
      ...browserContext,
      mode: config.browser_link_mode,
    })
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

  if (config.quick_entry_enabled) {
    const entryHotkey = config.quick_entry_hotkey || 'Alt+Shift+V'
    try {
      result.entry = globalShortcut.register(entryHotkey, toggleQuickEntry)
      if (!result.entry) console.error(`Failed to register Quick Entry shortcut: ${entryHotkey}`)
    } catch (err) {
      console.error(`Error registering entry shortcut "${entryHotkey}":`, err)
    }
  }

  if (config.quick_view_enabled !== false) {
    const viewerHotkey = config.quick_view_hotkey || 'Alt+Shift+B'
    try {
      result.viewer = globalShortcut.register(viewerHotkey, toggleQuickView)
      if (!result.viewer) console.error(`Failed to register Quick View shortcut: ${viewerHotkey}`)
    } catch (err) {
      console.error(`Error registering viewer shortcut "${viewerHotkey}":`, err)
    }
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
  if (config.quick_entry_enabled && !quickEntryWindow) {
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

  if (config.quick_view_enabled !== false && !quickViewWindow) {
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

  const eitherEnabled = config.quick_entry_enabled || config.quick_view_enabled !== false

  if (eitherEnabled) {
    setupTray()
    initQuickEntryWindows(config)
    const result = registerQuickEntryShortcuts(config)

    // Clean up windows that were disabled
    if (!config.quick_entry_enabled && quickEntryWindow && !quickEntryWindow.isDestroyed()) {
      quickEntryWindow.destroy()
      quickEntryWindow = null
    }
    if (config.quick_view_enabled === false && quickViewWindow && !quickViewWindow.isDestroyed()) {
      quickViewWindow.destroy()
      quickViewWindow = null
    }

    app.setLoginItemSettings({ openAtLogin: config.launch_on_startup === true })
    return result
  } else {
    // Clean up all windows and tray
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

  // Allow self-signed certs for Obsidian Local REST API (localhost only)
  app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
    try {
      const parsed = new URL(url)
      const config = loadConfig()
      const port = config?.obsidian_port || 27124
      if (parsed.hostname === '127.0.0.1' && parsed.port === String(port)) {
        event.preventDefault()
        callback(true)
        return
      }
    } catch { /* fall through */ }
    callback(false)
  })

  app.setAppUserModelId('com.vicu.app')

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

    // Initialize notification scheduler
    initNotifications(mainWindow)
    powerMonitor.on('resume', () => {
      rescheduleNotifications()
    })

    // Clean up stale browser host registrations if mode is off
    if (!config?.browser_link_mode || config.browser_link_mode === 'off') {
      const reg = isRegistered()
      if (reg.chrome || reg.firefox) unregisterHosts()
    }

    // Pre-warm PowerShell + UI Automation assemblies for faster browser URL fallback
    if (config?.browser_link_mode && config.browser_link_mode !== 'off') {
      prewarmUrlReader()
    }

    // Check for updates after a short delay so it doesn't block startup
    setTimeout(async () => {
      try {
        const status = await checkForUpdates()
        if (status.available && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-available', status)
        }
      } catch { /* never block app */ }
    }, 5000)

    // macOS: ALWAYS hide on close instead of destroying (standard macOS behavior).
    // Use app.isQuitting flag to allow actual quit via ⌘Q or tray Quit.
    if (isMac) {
      mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
          e.preventDefault()
          mainWindow?.hide()
        }
      })
    }

    // Quick Entry/View: if either enabled, set up tray + windows + hotkeys
    if (config?.quick_entry_enabled || config?.quick_view_enabled !== false) {
      setupTray()
      initQuickEntryWindows(config)
      globalShortcut.unregisterAll() // Clear stale registrations from crashes
      registerQuickEntryShortcuts(config)

      app.setLoginItemSettings({ openAtLogin: config.launch_on_startup === true })

      // Windows: when QE/QV is enabled, hide main window on close instead of quitting
      if (!isMac) {
        mainWindow.on('close', (e) => {
          if (!app.isQuitting) {
            e.preventDefault()
            mainWindow?.hide()
          }
        })
      }
    }
  })

  app.on('window-all-closed', () => {
    // macOS: never quit on window-all-closed (standard macOS behavior)
    // Windows: only quit if tray is not active
    if (!isMac && !hasTray()) {
      app.quit()
    }
  })

  app.on('activate', () => {
    // macOS: dock click or Cmd+Tab — show the existing hidden window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('before-quit', () => {
    app.isQuitting = true
  })

  app.on('will-quit', () => {
    stopNotifications()
    shutdownUrlReader()
    globalShortcut.unregisterAll()
    if (dragHoverTimer) {
      clearInterval(dragHoverTimer)
      dragHoverTimer = null
    }
    destroyTray()
  })
}
