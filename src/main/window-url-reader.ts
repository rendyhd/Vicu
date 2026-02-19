import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { BrowserContext } from './browser-client'

export const BROWSER_PROCESSES = new Set([
  'chrome', 'firefox', 'msedge', 'brave', 'opera', 'vivaldi'
])

let prewarmProcess: ChildProcess | null = null

function getScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'get-browser-url.ps1')
  }
  return join(app.getAppPath(), 'resources', 'get-browser-url.ps1')
}

export function getBrowserUrlFromWindow(processName: string): Promise<BrowserContext | null> {
  return new Promise((resolve) => {
    try {
      const scriptPath = getScriptPath()
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-ProcessName', processName
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })

      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })

      child.on('close', () => {
        const line = stdout.trim()
        if (!line) { resolve(null); return }

        const tabIdx = line.indexOf('\t')
        if (tabIdx === -1) { resolve(null); return }

        const url = line.slice(0, tabIdx)
        const title = line.slice(tabIdx + 1) || url
        const displayTitle = title.length > 40 ? title.slice(0, 37) + '...' : title

        resolve({ url, title, displayTitle })
      })

      child.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

export function prewarmUrlReader(): void {
  try {
    prewarmProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes'
    ], {
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    })
    prewarmProcess.unref()
  } catch { /* ignore */ }
}

export function shutdownUrlReader(): void {
  if (prewarmProcess && !prewarmProcess.killed) {
    try { prewarmProcess.kill() } catch { /* ignore */ }
    prewarmProcess = null
  }
}
