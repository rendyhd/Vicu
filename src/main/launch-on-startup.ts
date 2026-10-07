import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { autostartDesktopEntry, autostartFilePath, resolveAutostartExec } from './autostart-linux'
import { buildLoginItemSettings, type LoginItemSettingsPayload } from './login-item-settings'

/**
 * Applies the "Launch on startup" and "Start hidden" settings for the current platform: the login
 * item API on Windows and macOS, an XDG autostart entry on Linux. The environment is passed in so
 * the file and API work can be tested without touching the real system.
 */
export interface StartupEnv {
  platform: NodeJS.Platform
  isPackaged: boolean
  /** process.env.APPIMAGE */
  appImage?: string
  /** process.execPath */
  execPath: string
  /** Linux: $XDG_CONFIG_HOME or ~/.config */
  configDir: string
  setLoginItemSettings(settings: LoginItemSettingsPayload): void
}

export interface StartupSettings {
  launchOnStartup: boolean
  startHidden: boolean
}

/**
 * The Run-key value name Windows builds before the AppUserModelID fix used (Electron names the
 * value after the AUMID). Without removing it, "launch on startup" would start Vicu twice and the
 * old entry could no longer be switched off.
 */
const LEGACY_WINDOWS_LOGIN_ITEM_NAME = 'com.vicu.app'

function linuxExec(env: StartupEnv): string | null {
  return resolveAutostartExec({ isPackaged: env.isPackaged, appImage: env.appImage, execPath: env.execPath })
}

/** Whether the option can be offered: always on Windows and macOS, on Linux only when the executable is known. */
export function getLaunchOnStartupSupport(env: StartupEnv): { supported: boolean } {
  if (env.platform === 'linux') return { supported: linuxExec(env) !== null }
  return { supported: true }
}

export function applyLaunchOnStartup(settings: StartupSettings, env: StartupEnv): void {
  if (env.platform === 'linux') {
    applyLinuxAutostart(settings, env)
    return
  }
  // Only an installed build owns that entry; a development run must not touch the registry for it.
  if (env.platform === 'win32' && env.isPackaged) {
    env.setLoginItemSettings({ openAtLogin: false, name: LEGACY_WINDOWS_LOGIN_ITEM_NAME })
  }
  env.setLoginItemSettings(
    buildLoginItemSettings({
      openAtLogin: settings.launchOnStartup,
      isMac: env.platform === 'darwin',
      startHidden: settings.startHidden,
    }),
  )
}

function applyLinuxAutostart(settings: StartupSettings, env: StartupEnv): void {
  const file = autostartFilePath(env.configDir)
  if (!settings.launchOnStartup) {
    rmSync(file, { force: true })
    return
  }
  const exec = linuxExec(env)
  if (!exec) return
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, autostartDesktopEntry({ exec, startHidden: settings.startHidden }), 'utf-8')
}
