import { describe, it, expect } from 'vitest'
import { buildLoginItemSettings } from '../login-item-settings'

describe('buildLoginItemSettings', () => {
  it('returns openAtLogin only on non-macOS', () => {
    expect(buildLoginItemSettings({ openAtLogin: true, isMac: false })).toEqual({
      openAtLogin: true,
    })
    expect(buildLoginItemSettings({ openAtLogin: false, isMac: false })).toEqual({
      openAtLogin: false,
    })
  })

  it('includes name on macOS without openAsHidden', () => {
    const settings = buildLoginItemSettings({ openAtLogin: true, isMac: true })
    expect(settings).toEqual({ openAtLogin: true, name: 'Vicu' })
    expect(settings).not.toHaveProperty('openAsHidden')
  })

  it('keeps openAtLogin false on macOS when launch-on-startup is off', () => {
    expect(buildLoginItemSettings({ openAtLogin: false, isMac: true })).toEqual({
      openAtLogin: false,
      name: 'Vicu',
    })
  })
})
