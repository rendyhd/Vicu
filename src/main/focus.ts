import { BrowserWindow } from 'electron'
import { isWindows } from './platform'

/**
 * Giving focus back after a Quick Entry or Quick View window hides (Windows only; on macOS focus
 * returns to the previous app by itself, Linux has no way to ask).
 *
 * Before a popup shows, `rememberForegroundWindow` keeps the window that was in front. When the
 * popup hides while it still has focus (Escape, Enter, the hotkey), `giveFocusBack` brings exactly
 * that window to the front again, before the popup hides: our process still owns the foreground
 * then, so Windows allows it. Leaving the choice to Windows picked the next window of our own
 * process, the main window, which came forward (opened) when the user only meant to close the
 * popup.
 *
 * When the remembered window is gone or Windows refuses, the old fallback runs after the hide: a
 * cached tiny transparent dummy window is shown, focused and hidden, so Windows moves focus on.
 * When the popup hides because it lost focus (a click elsewhere), nothing is done: the user already
 * chose where focus goes.
 */

type Hwnd = unknown

interface User32 {
  GetForegroundWindow: () => Hwnd
  SetForegroundWindow: (hwnd: Hwnd) => number
  IsWindow: (hwnd: Hwnd) => number
  IsWindowVisible: (hwnd: Hwnd) => number
  IsIconic: (hwnd: Hwnd) => number
}

let user32: User32 | null = null
let user32Loaded = false

function loadUser32(): User32 | null {
  if (user32Loaded) return user32
  user32Loaded = true
  if (!isWindows) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const lib = koffi.load('user32.dll')
    user32 = {
      GetForegroundWindow: lib.func('void* __stdcall GetForegroundWindow()'),
      SetForegroundWindow: lib.func('int __stdcall SetForegroundWindow(void *hWnd)'),
      IsWindow: lib.func('int __stdcall IsWindow(void *hWnd)'),
      IsWindowVisible: lib.func('int __stdcall IsWindowVisible(void *hWnd)'),
      IsIconic: lib.func('int __stdcall IsIconic(void *hWnd)'),
    }
  } catch (err) {
    console.warn('Failed to load user32 for focus return:', err)
    user32 = null
  }
  return user32
}

/** Pre-load koffi and user32 so the first popup does not pay for it. */
export function prewarmFocusReturn(): void {
  loadUser32()
}

export type PopupKind = 'entry' | 'viewer'

const remembered = new Map<PopupKind, Hwnd>()

/**
 * Keep the window in front before the popup shows. Call it only while the popup is hidden, so the
 * popup itself is never remembered.
 */
export function rememberForegroundWindow(kind: PopupKind): void {
  const api = loadUser32()
  if (!api) return
  try {
    const hwnd = api.GetForegroundWindow()
    if (hwnd) remembered.set(kind, hwnd)
    else remembered.delete(kind)
  } catch {
    remembered.delete(kind)
  }
}

/**
 * Bring the remembered window to the front. Call it while the popup still has focus, right before
 * hiding it. Returns false when it could not, so the caller falls back to `nudgeFocusAway` after
 * the hide.
 */
export function giveFocusBack(kind: PopupKind): boolean {
  const hwnd = remembered.get(kind)
  remembered.delete(kind)
  const api = loadUser32()
  if (!api || !hwnd) return false
  try {
    if (!api.IsWindow(hwnd) || !api.IsWindowVisible(hwnd) || api.IsIconic(hwnd)) return false
    return api.SetForegroundWindow(hwnd) !== 0
  } catch {
    return false
  }
}

/** Forget the remembered window, for a hide that leaves focus where it is. */
export function forgetForegroundWindow(kind: PopupKind): void {
  remembered.delete(kind)
}

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

/** The fallback: let Windows move focus on from a hidden popup. */
export function nudgeFocusAway(): void {
  if (!isWindows) return

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
