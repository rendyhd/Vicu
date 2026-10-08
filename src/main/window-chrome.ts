import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * Which window chrome the main window gets on each platform (card 5.1). Pure, so the choice is
 * tested per platform and Windows build number without Electron:
 *
 * - macOS: native traffic lights over a vibrancy sidebar (unchanged).
 * - Windows: the system's own caption buttons drawn over the title band (`titleBarOverlay`, which
 *   is what gives Snap Layouts), and Mica behind the sidebar where the system has it.
 * - Linux: frameless; the renderer draws its own window controls.
 */

export type ChromePlatform = 'darwin' | 'win32' | 'linux'

/** Height of the title band in px: the renderer's h-8 drag strip and the caption button height. */
export const TITLE_BAND_HEIGHT = 32

/**
 * `backgroundMaterial` goes through DWMWA_SYSTEMBACKDROP_TYPE, which Windows honours from 11 22H2
 * (build 22621). Windows 11 21H2 (22000) and Windows 10 ignore it, so they keep an opaque sidebar.
 */
export const MICA_MIN_BUILD = 22621

/**
 * Title band colours: the page background (the caption buttons sit over the content, right of the
 * sidebar) and text.secondary for the symbols, from test-fixtures/design-tokens-v1.json
 * (window-chrome.test.ts fails when they drift).
 */
export const TITLE_BAND_COLORS = {
  light: { color: '#FFFFFF', symbolColor: '#636366' },
  dark: { color: '#1C1C1E', symbolColor: '#AEAEB2' },
} as const

export type WindowMaterial = 'mica' | 'none'

/** The Windows build number from os.release() ("10.0.22631" gives 22631); 0 when it is not Windows-shaped. */
export function windowsBuildFromRelease(release: string): number {
  const parts = release.split('.')
  if (parts.length < 3) return 0
  const build = Number(parts[2])
  return Number.isInteger(build) && build > 0 ? build : 0
}

export function windowMaterialFor(platform: ChromePlatform, windowsBuild: number): WindowMaterial {
  return platform === 'win32' && windowsBuild >= MICA_MIN_BUILD ? 'mica' : 'none'
}

/** Whether the window is dark: a chosen theme wins, the system theme (or none) follows the system. */
export function isDarkChrome(theme: string | null | undefined, systemDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return systemDark
}

export function titleBandOverlay(dark: boolean): { color: string; symbolColor: string; height: number } {
  return { ...TITLE_BAND_COLORS[dark ? 'dark' : 'light'], height: TITLE_BAND_HEIGHT }
}

export interface WindowChromeInput {
  platform: ChromePlatform
  /** Windows build number (os.release()); ignored elsewhere. */
  windowsBuild: number
  dark: boolean
}

/** The BrowserWindow options that decide the chrome. Everything else about the window is the caller's. */
export function windowChromeOptions(input: WindowChromeInput): BrowserWindowConstructorOptions {
  switch (input.platform) {
    case 'darwin':
      return {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 14 },
        vibrancy: 'sidebar',
        visualEffectState: 'followWindow',
        backgroundColor: '#00000000',
        acceptFirstMouse: true,
      }
    case 'win32': {
      const options: BrowserWindowConstructorOptions = {
        titleBarStyle: 'hidden',
        titleBarOverlay: titleBandOverlay(input.dark),
      }
      if (windowMaterialFor('win32', input.windowsBuild) === 'mica') {
        // Transparent web content lets Mica show; the renderer keeps the content region opaque.
        options.backgroundMaterial = 'mica'
        options.backgroundColor = '#00000000'
      }
      return options
    }
    default:
      return { frame: false }
  }
}
