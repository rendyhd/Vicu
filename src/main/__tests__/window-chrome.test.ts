import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MICA_MIN_BUILD,
  TITLE_BAND_COLORS,
  TITLE_BAND_HEIGHT,
  isDarkChrome,
  titleBandOverlay,
  windowChromeOptions,
  windowMaterialFor,
  windowsBuildFromRelease,
} from '../window-chrome'

const tokens = JSON.parse(readFileSync(join(__dirname, '../../../test-fixtures/design-tokens-v1.json'), 'utf8')) as {
  roles: Record<string, { light: string; dark: string }>
}

describe('windowsBuildFromRelease', () => {
  it('reads the build from os.release()', () => {
    expect(windowsBuildFromRelease('10.0.26200')).toBe(26200)
    expect(windowsBuildFromRelease('10.0.19045')).toBe(19045)
    expect(windowsBuildFromRelease('10.0.22000')).toBe(22000)
  })

  it('gives 0 for anything not Windows-shaped', () => {
    expect(windowsBuildFromRelease('')).toBe(0)
    expect(windowsBuildFromRelease('6.5')).toBe(0)
    expect(windowsBuildFromRelease('23.4.0')).toBe(0)
    expect(windowsBuildFromRelease('6.8.0-45-generic')).toBe(0)
    expect(windowsBuildFromRelease('10.0.abc')).toBe(0)
  })
})

describe('windowMaterialFor', () => {
  it('is mica on Windows 11 22H2 and later only', () => {
    expect(windowMaterialFor('win32', MICA_MIN_BUILD)).toBe('mica')
    expect(windowMaterialFor('win32', 26200)).toBe('mica')
    expect(windowMaterialFor('win32', MICA_MIN_BUILD - 1)).toBe('none')
    expect(windowMaterialFor('win32', 22000)).toBe('none')
    expect(windowMaterialFor('win32', 19045)).toBe('none')
    expect(windowMaterialFor('win32', 0)).toBe('none')
  })

  it('is none off Windows whatever the number', () => {
    expect(windowMaterialFor('darwin', 26200)).toBe('none')
    expect(windowMaterialFor('linux', 26200)).toBe('none')
  })
})

describe('windowChromeOptions', () => {
  it('Windows 11 gets the native caption buttons and Mica', () => {
    const options = windowChromeOptions({ platform: 'win32', windowsBuild: 26200, dark: false })
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual({ color: '#FFFFFF', symbolColor: '#636366', height: TITLE_BAND_HEIGHT })
    expect(options.backgroundMaterial).toBe('mica')
    expect(options.backgroundColor).toBe('#00000000')
    expect(options.frame).toBeUndefined()
  })

  it('Windows 10 and Windows 11 21H2 keep the caption buttons but no Mica', () => {
    for (const windowsBuild of [19045, 22000, 22620]) {
      const options = windowChromeOptions({ platform: 'win32', windowsBuild, dark: true })
      expect(options.titleBarStyle).toBe('hidden')
      expect(options.titleBarOverlay).toEqual({ color: '#1C1C1E', symbolColor: '#AEAEB2', height: TITLE_BAND_HEIGHT })
      expect(options.backgroundMaterial).toBeUndefined()
      expect(options.backgroundColor).toBeUndefined()
    }
  })

  it('macOS keeps the traffic lights and vibrancy and never gets an overlay or Mica', () => {
    const options = windowChromeOptions({ platform: 'darwin', windowsBuild: 26200, dark: false })
    expect(options).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 14 },
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
      acceptFirstMouse: true,
    })
  })

  it('Linux is frameless (the renderer draws the controls)', () => {
    expect(windowChromeOptions({ platform: 'linux', windowsBuild: 0, dark: true })).toEqual({ frame: false })
  })
})

describe('title band colours', () => {
  it('follow the theme', () => {
    expect(titleBandOverlay(false).color).toBe(TITLE_BAND_COLORS.light.color)
    expect(titleBandOverlay(true).color).toBe(TITLE_BAND_COLORS.dark.color)
    expect(titleBandOverlay(true).height).toBe(32)
  })

  it('are the bg.page and text.secondary values of the token contract', () => {
    expect(TITLE_BAND_COLORS.light.color).toBe(tokens.roles['bg.page'].light)
    expect(TITLE_BAND_COLORS.dark.color).toBe(tokens.roles['bg.page'].dark)
    expect(TITLE_BAND_COLORS.light.symbolColor).toBe(tokens.roles['text.secondary'].light)
    expect(TITLE_BAND_COLORS.dark.symbolColor).toBe(tokens.roles['text.secondary'].dark)
  })
})

describe('isDarkChrome', () => {
  it('lets a chosen theme win and follows the system otherwise', () => {
    expect(isDarkChrome('dark', false)).toBe(true)
    expect(isDarkChrome('light', true)).toBe(false)
    expect(isDarkChrome('system', true)).toBe(true)
    expect(isDarkChrome(undefined, false)).toBe(false)
    expect(isDarkChrome(null, true)).toBe(true)
  })
})
