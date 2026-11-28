// Absolute paths of the system programs Vicu starts, so a copy of `powershell.exe` or `osascript`
// placed in the working directory or earlier on the PATH is never the one that runs. No Electron.
import { join } from 'node:path'

/** Windows PowerShell 5.1, from the system folder (`SystemRoot`, else `C:/Windows`). */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** macOS's own AppleScript runner. */
export const OSASCRIPT_PATH = '/usr/bin/osascript'
