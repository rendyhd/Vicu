import { BrowserWindow } from 'electron'

/**
 * Attempts to return focus to the previously active window after hiding
 * the quick entry window. On Windows, simply hiding the window usually
 * returns focus. If it doesn't, we show a cached tiny transparent dummy
 * window, focus it, then immediately hide it — triggering Windows to
 * cycle focus back to the previously active app.
 *
 * The dummy window is created once and reused to avoid the cost of
 * BrowserWindow creation on every hide.
 *
 * macOS: no-op. Focus returns automatically to the previously active app
 * when our window hides — no dummy-window trick needed.
 */
let dummyWindow: BrowserWindow | null = null

function getDummyWindow(): BrowserWindow {
  if (dummyWindow && !dummyWindow.isDestroyed()) return dummyWindow

  dummyWindow = new BrowserWindow({
    width: 1,
    height: 1,
    x: -100,
    y: -100,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
  })

  // Prevent the dummy window from being closed — just hide it
  dummyWindow.on('close', (e) => {
    e.preventDefault()
    dummyWindow?.hide()
  })

  return dummyWindow
}

export function returnFocusToPreviousWindow(): void {
  if (process.platform !== 'win32') return

  const dummy = getDummyWindow()
  dummy.showInactive()
  dummy.focus()

  setImmediate(() => {
    dummy.hide()
  })
}

export function destroyDummyWindow(): void {
  if (dummyWindow && !dummyWindow.isDestroyed()) {
    // Remove close handler so destroy() works
    dummyWindow.removeAllListeners('close')
    dummyWindow.destroy()
  }
  dummyWindow = null
}
