import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import type { StartupEnv } from './launch-on-startup'

/** The real environment for applyLaunchOnStartup. */
export function startupEnv(): StartupEnv {
  return {
    // The platform is passed as data so launch-on-startup.ts can be tested for every platform.
    platform: process.platform,
    isPackaged: app.isPackaged,
    appImage: process.env.APPIMAGE,
    execPath: process.execPath,
    configDir: process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
  }
}
