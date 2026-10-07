import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  autostartDesktopEntry,
  autostartFilePath,
  quoteDesktopExecArg,
  resolveAutostartExec,
} from '../autostart-linux'
import { applyLaunchOnStartup, getLaunchOnStartupSupport, type StartupEnv } from '../launch-on-startup'

describe('quoteDesktopExecArg (Desktop Entry Exec quoting)', () => {
  it('leaves a plain path alone', () => {
    expect(quoteDesktopExecArg('/opt/Vicu/vicu')).toBe('/opt/Vicu/vicu')
    expect(quoteDesktopExecArg('/home/u/Apps/Vicu-1.8.1-x64.AppImage')).toBe('/home/u/Apps/Vicu-1.8.1-x64.AppImage')
    expect(quoteDesktopExecArg('--hidden')).toBe('--hidden')
  })

  it('double-quotes a path with spaces', () => {
    expect(quoteDesktopExecArg('/home/u/My Apps/Vicu.AppImage')).toBe('"/home/u/My Apps/Vicu.AppImage"')
  })

  it('escapes the characters that stay special inside quotes, and doubles the backslash for the file format', () => {
    expect(quoteDesktopExecArg('/a b/$HOME')).toBe('"/a b/\\\\$HOME"')
    expect(quoteDesktopExecArg('/a b/"x"')).toBe('"/a b/\\\\"x\\\\""')
    expect(quoteDesktopExecArg('/a b/`x`')).toBe('"/a b/\\\\`x\\\\`"')
    expect(quoteDesktopExecArg('/a b\\c')).toBe('"/a b\\\\\\\\c"')
  })

  it('doubles a percent sign so it is not read as a field code', () => {
    expect(quoteDesktopExecArg('/opt/50%/vicu')).toBe('"/opt/50%%/vicu"')
  })
})

describe('autostartDesktopEntry', () => {
  it('writes a complete autostart entry', () => {
    expect(autostartDesktopEntry({ exec: '/opt/Vicu/vicu', startHidden: false })).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        'Name=Vicu',
        'Comment=Task management app powered by Vikunja',
        'Exec=/opt/Vicu/vicu',
        'Terminal=false',
        'StartupWMClass=com.rendyhd.vicu',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'),
    )
  })

  it('adds --hidden when the app should start in the tray', () => {
    const entry = autostartDesktopEntry({ exec: '/home/u/My Apps/Vicu.AppImage', startHidden: true })
    expect(entry).toContain('Exec="/home/u/My Apps/Vicu.AppImage" --hidden\n')
  })

  it('refuses an executable path with a line break, which would add keys to the entry', () => {
    expect(() => autostartDesktopEntry({ exec: '/opt/vicu\nExec=/bin/sh', startHidden: false })).toThrow()
  })
})

describe('autostartFilePath', () => {
  it('lives in the autostart folder of the XDG config dir, named after the app id', () => {
    expect(autostartFilePath('/home/u/.config')).toBe(join('/home/u/.config', 'autostart', 'com.rendyhd.vicu.desktop'))
  })
})

describe('resolveAutostartExec', () => {
  it('uses the AppImage file, not the temporary mount the app runs from', () => {
    expect(
      resolveAutostartExec({
        isPackaged: true,
        appImage: '/home/u/Vicu-1.8.1-x64.AppImage',
        execPath: '/tmp/.mount_ViCuQ1/vicu',
      }),
    ).toBe('/home/u/Vicu-1.8.1-x64.AppImage')
  })

  it('uses the executable of an installed (non-AppImage) build', () => {
    expect(resolveAutostartExec({ isPackaged: true, execPath: '/opt/Vicu/vicu' })).toBe('/opt/Vicu/vicu')
  })

  it('has no answer in a development run, where execPath is the bare Electron binary', () => {
    expect(resolveAutostartExec({ isPackaged: false, execPath: '/repo/node_modules/electron/dist/electron' })).toBeNull()
  })

  it('has no answer when the only path is a temporary AppImage mount', () => {
    expect(resolveAutostartExec({ isPackaged: true, execPath: '/tmp/.mount_ViCuQ1/vicu' })).toBeNull()
  })

  it('has no answer for a relative or empty path', () => {
    expect(resolveAutostartExec({ isPackaged: true, appImage: 'Vicu.AppImage', execPath: '/tmp/.mount_x/vicu' })).toBeNull()
    expect(resolveAutostartExec({ isPackaged: true, execPath: '' })).toBeNull()
  })
})

describe('applyLaunchOnStartup', () => {
  let dir = ''
  let setLoginItemSettings: ReturnType<typeof vi.fn>

  function env(over: Partial<StartupEnv> = {}): StartupEnv {
    return {
      platform: 'linux',
      isPackaged: true,
      appImage: '/home/u/Vicu.AppImage',
      execPath: '/tmp/.mount_ViCuQ1/vicu',
      configDir: dir,
      setLoginItemSettings: setLoginItemSettings as unknown as StartupEnv['setLoginItemSettings'],
      ...over,
    }
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-autostart-'))
    setLoginItemSettings = vi.fn()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const file = () => join(dir, 'autostart', 'com.rendyhd.vicu.desktop')

  it('writes the autostart entry on Linux, pointing at the AppImage, and leaves the login item API alone', () => {
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: false }, env())
    expect(readFileSync(file(), 'utf8')).toContain('Exec=/home/u/Vicu.AppImage\n')
    expect(setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('adds --hidden for a hidden start', () => {
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: true }, env())
    expect(readFileSync(file(), 'utf8')).toContain('Exec=/home/u/Vicu.AppImage --hidden\n')
  })

  it('rewrites the entry when the option changes and removes it when launch on startup is turned off', () => {
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: false }, env())
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: true }, env())
    expect(readFileSync(file(), 'utf8')).toContain('--hidden')
    applyLaunchOnStartup({ launchOnStartup: false, startHidden: true }, env())
    expect(existsSync(file())).toBe(false)
  })

  it('turning it off when there is no entry is not an error', () => {
    expect(() => applyLaunchOnStartup({ launchOnStartup: false, startHidden: false }, env())).not.toThrow()
  })

  it('writes nothing when the executable path cannot be determined', () => {
    applyLaunchOnStartup(
      { launchOnStartup: true, startHidden: false },
      env({ isPackaged: false, appImage: undefined, execPath: '/repo/node_modules/electron/dist/electron' }),
    )
    expect(existsSync(join(dir, 'autostart'))).toBe(false)
  })

  it('does not touch an unrelated file in the autostart folder', () => {
    mkdirSync(join(dir, 'autostart'), { recursive: true })
    writeFileSync(join(dir, 'autostart', 'other.desktop'), '[Desktop Entry]\n')
    applyLaunchOnStartup({ launchOnStartup: false, startHidden: false }, env())
    expect(existsSync(join(dir, 'autostart', 'other.desktop'))).toBe(true)
  })

  it('reports whether the option can be offered', () => {
    expect(getLaunchOnStartupSupport(env())).toEqual({ supported: true })
    expect(
      getLaunchOnStartupSupport(env({ isPackaged: false, appImage: undefined, execPath: '/repo/node_modules/electron/dist/electron' })),
    ).toEqual({ supported: false })
    expect(getLaunchOnStartupSupport(env({ platform: 'win32' }))).toEqual({ supported: true })
    expect(getLaunchOnStartupSupport(env({ platform: 'darwin' }))).toEqual({ supported: true })
  })

  it('uses the login item API on Windows and macOS, never the autostart folder', () => {
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: true }, env({ platform: 'win32' }))
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--hidden'] })
    expect(existsSync(join(dir, 'autostart'))).toBe(false)

    setLoginItemSettings.mockClear()
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: true }, env({ platform: 'darwin' }))
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, name: 'Vicu' })
  })

  it('does not touch the old-id login entry from a development run', () => {
    applyLaunchOnStartup({ launchOnStartup: false, startHidden: false }, env({ platform: 'win32', isPackaged: false }))
    expect(setLoginItemSettings).toHaveBeenCalledTimes(1)
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })

  it('removes the Windows login entry written under the old app id', () => {
    applyLaunchOnStartup({ launchOnStartup: true, startHidden: false }, env({ platform: 'win32' }))
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, name: 'com.vicu.app' })
    expect(setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true })
  })
})
