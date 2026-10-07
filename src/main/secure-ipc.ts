import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { assertTrustedSender } from './web-security'

/**
 * Drop-in replacement for `ipcMain.handle` that refuses calls from anything
 * other than a top-level app page (main window, Quick Entry, Quick View). Every
 * IPC handler goes through here so a navigated or injected frame cannot reach
 * the Vikunja client, token store or filesystem helpers (D-SEC-1).
 *
 * A source-scan test (secure-ipc.test.ts) fails if any file registers a handler
 * with ipcMain.handle directly.
 */
export function handleTrusted(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<unknown> | unknown
): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}
