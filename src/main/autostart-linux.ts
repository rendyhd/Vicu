import { join } from 'path'
import { APP_ID } from './app-id'

/**
 * "Launch on startup" on Linux. Electron's setLoginItemSettings does nothing there, so the app
 * writes an XDG autostart entry (a .desktop file in ~/.config/autostart) itself (D-LNX-1).
 * Pure functions only; the file work is in launch-on-startup.ts.
 */

/** The file the desktop environment reads at login: <config dir>/autostart/<app id>.desktop. */
export function autostartFilePath(configDir: string): string {
  return join(configDir, 'autostart', `${APP_ID}.desktop`)
}

// Characters that need no quoting in an Exec argument.
const PLAIN_EXEC_ARG = /^[A-Za-z0-9_@+=:,./-]+$/

/**
 * Quote one argument for the Exec key (Desktop Entry spec). A plain argument is written as is. Any
 * other is double-quoted; inside the quotes `"`, `` ` ``, `$` and `\` need a backslash, and each
 * backslash is doubled again because the file format itself treats `\` as an escape. A literal `%`
 * is written `%%` so it is not taken for a field code.
 */
export function quoteDesktopExecArg(arg: string): string {
  const percentSafe = arg.replace(/%/g, '%%')
  if (PLAIN_EXEC_ARG.test(arg)) return percentSafe
  const escaped = percentSafe
    .replace(/\\/g, '\\\\\\\\')
    .replace(/["`$]/g, (ch) => `\\\\${ch}`)
  return `"${escaped}"`
}

export interface AutostartEntryOptions {
  /** Absolute path of the executable (the AppImage file for an AppImage). */
  exec: string
  startHidden: boolean
}

export function autostartDesktopEntry(options: AutostartEntryOptions): string {
  // A line break in the path would start a new key in the entry.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(options.exec)) throw new Error('The executable path contains a control character')
  const exec = [quoteDesktopExecArg(options.exec), ...(options.startHidden ? ['--hidden'] : [])].join(' ')
  return (
    [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      'Name=Vicu',
      'Comment=Task management app powered by Vikunja',
      `Exec=${exec}`,
      'Terminal=false',
      `StartupWMClass=${APP_ID}`,
      'X-GNOME-Autostart-enabled=true',
    ].join('\n') + '\n'
  )
}

export interface AutostartExecInput {
  isPackaged: boolean
  /** process.env.APPIMAGE */
  appImage?: string
  /** process.execPath */
  execPath: string
}

const APPIMAGE_MOUNT = /\/\.mount_[^/]+(\/|$)/

function isAbsolutePosix(path: string): boolean {
  return path.startsWith('/')
}

/**
 * What the autostart entry should run, or null when that cannot be told (the option is then not
 * offered): the AppImage file when running from one, otherwise the executable of an installed
 * build. Never the temporary mount an AppImage runs from (gone after exit) and never the bare
 * Electron binary of a development run.
 */
export function resolveAutostartExec(input: AutostartExecInput): string | null {
  if (input.appImage) return isAbsolutePosix(input.appImage) ? input.appImage : null
  if (!input.isPackaged) return null
  const exec = input.execPath
  if (!exec || !isAbsolutePosix(exec) || APPIMAGE_MOUNT.test(exec)) return null
  return exec
}
