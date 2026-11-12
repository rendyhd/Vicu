// Classic Outlook on this PC (contract 20.9): runs resources/outlook/outlook-calendar.ps1 with
// Windows PowerShell, one process per question, and reads its one JSON answer. Windows only; the
// kind itself is sources/outlook.ts.
//
// The script attaches to an Outlook that is already open and never starts one, reads only the
// fields Vicu shows, and never writes. See the script for what it touches.

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { isWindows } from '../platform'
import { CalendarReadError } from './http'
import type { OutlookRunner } from './sources/outlook'

/** A question takes this long at most (a large calendar's window included). */
const TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

function scriptPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'outlook', 'outlook-calendar.ps1')
    : join(app.getAppPath(), 'resources', 'outlook', 'outlook-calendar.ps1')
}

/** The last line of the script's output that reads as JSON. */
export function parseAnswer(stdout: string): unknown {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue
    try {
      return JSON.parse(lines[i])
    } catch {
      // Not the answer.
    }
  }
  return null
}

/** Run the script with PowerShell; throws a CalendarReadError when there is no answer. */
export const powershellOutlookRunner: OutlookRunner = (command, args = {}) => {
  if (!isWindows) return Promise.reject(new CalendarReadError('Classic Outlook can only be read on Windows.', 'other'))
  const path = scriptPath()
  if (!existsSync(path)) return Promise.reject(new CalendarReadError('Reading classic Outlook is not part of this build of Vicu.', 'other'))
  const extra = Object.entries(args).flatMap(([key, value]) => [`-${key}`, String(value)])
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, '-Command', command, ...extra],
      { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        const answer = parseAnswer(String(stdout ?? ''))
        if (answer) return resolve(answer)
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          return reject(new CalendarReadError('Outlook took too long to answer. Try again in a moment.', 'timeout'))
        }
        reject(new CalendarReadError('Outlook did not answer. Check that classic Outlook is open, then try again.', 'other'))
      },
    )
  })
}
