import { BrowserWindow, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

let printInFlight = false

// Loads the pre-built print document into a hidden window and opens the
// system print dialog. A temp file (not a data: URL) sidesteps Chromium's
// data-URL size limit for task lists with many embedded notes.
export async function printHtml(
  html: string
): Promise<{ success: true } | { success: false; error: string }> {
  if (printInFlight) return { success: false, error: 'A print job is already in progress' }
  printInFlight = true

  const tempFile = path.join(app.getPath('temp'), `vicu-print-${Date.now()}.html`)
  let win: BrowserWindow | null = null
  try {
    await fs.promises.writeFile(tempFile, html, 'utf-8')
    win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    await win.loadURL(pathToFileURL(tempFile).toString())

    const result = await new Promise<{ ok: boolean; reason: string }>((resolve) => {
      win!.webContents.print({ printBackground: true }, (ok, reason) =>
        resolve({ ok, reason })
      )
    })

    if (!result.ok && !/cancel/i.test(result.reason)) {
      return { success: false, error: result.reason || 'Print failed' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    win?.destroy()
    fs.promises.unlink(tempFile).catch(() => {})
    printInFlight = false
  }
}
