import { app } from 'electron'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { join } from 'path'
import type { BrowserContext } from './browser-client'

export const BROWSER_PROCESSES = new Set(
  process.platform === 'darwin'
    ? ['Google Chrome', 'Firefox', 'Microsoft Edge', 'Brave Browser', 'Safari', 'Opera', 'Vivaldi', 'Arc']
    : ['chrome', 'firefox', 'msedge', 'brave', 'opera', 'vivaldi']
)

let prewarmProcess: ChildProcess | null = null

function getScriptPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'get-browser-url.ps1')
  }
  return join(app.getAppPath(), 'resources', 'get-browser-url.ps1')
}

// --- macOS: AppleScript-based browser URL detection ---

function getBrowserUrlMacOS(appName: string): Promise<BrowserContext | null> {
  return new Promise((resolve) => {
    let script: string

    // Chromium-based browsers all support Google Chrome's AppleScript dictionary
    const chromiumBrowsers = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Vivaldi', 'Opera', 'Arc']

    if (chromiumBrowsers.includes(appName)) {
      script = `
        using terms from application "Google Chrome"
          tell application "${appName}"
            set tabUrl to URL of active tab of front window
            set tabTitle to title of active tab of front window
            return tabUrl & "\t" & tabTitle
          end tell
        end using terms from`
    } else if (appName === 'Safari') {
      script = `
        tell application "Safari"
          set tabUrl to URL of front document
          set tabTitle to name of front document
          return tabUrl & "\t" & tabTitle
        end tell`
    } else if (appName === 'Firefox') {
      // Firefox has no AppleScript dictionary — unreliable accessibility fallback
      script = `
        tell application "System Events"
          tell process "Firefox"
            try
              set urlValue to value of UI element 1 of combo box 1 of toolbar "Navigation" of front window
              set winTitle to name of front window
              return urlValue & "\t" & winTitle
            on error
              return ""
            end try
          end tell
        end tell`
    } else {
      resolve(null)
      return
    }

    execFile('osascript', ['-e', script], { timeout: 3000 }, (err, stdout) => {
      if (err) { resolve(null); return }
      const line = stdout.trim()
      if (!line) { resolve(null); return }

      const tabIdx = line.indexOf('\t')
      if (tabIdx === -1) { resolve(null); return }

      const url = line.slice(0, tabIdx)
      const title = line.slice(tabIdx + 1) || url

      // Validate URL
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        resolve(null)
        return
      }

      const displayTitle = title.length > 40 ? title.slice(0, 37) + '...' : title
      resolve({ url, title, displayTitle })
    })
  })
}

// --- Main entry point: platform-aware URL detection ---

export function getBrowserUrlFromWindow(processName: string, hwnd?: number): Promise<BrowserContext | null> {
  if (process.platform === 'darwin') {
    return getBrowserUrlMacOS(processName)
  }

  // Windows: PowerShell implementation
  return new Promise((resolve) => {
    try {
      const scriptPath = getScriptPath()
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-ProcessName', processName,
        ...(hwnd ? ['-Hwnd', String(hwnd)] : [])
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
  if (process.platform !== 'win32') return
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
  if (process.platform !== 'win32') return
  if (prewarmProcess && !prewarmProcess.killed) {
    try { prewarmProcess.kill() } catch { /* ignore */ }
    prewarmProcess = null
  }
}
