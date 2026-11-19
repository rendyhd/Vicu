import { BrowserWindow } from 'electron'

// `@host/windows`, the Electron side: tell every window something changed. The web build swaps this
// module for src/web/host/windows.ts, where the page's own listeners (and other tabs) are told.

/** Send to every open window. A window that is going away is skipped. */
export function sendToAllWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, ...args)
    } catch { /* window may close between enumeration and send */ }
  }
}
