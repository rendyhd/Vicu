import { describe, it, expect } from 'vitest'
import { buildLoginItemSettings, parseHiddenArg, shouldStartHidden, startWindowState, START_HIDDEN_ARG } from '../login-item-settings'

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

describe('buildLoginItemSettings with start hidden', () => {
  it('registers --hidden as an argument of the Windows login item', () => {
    expect(buildLoginItemSettings({ openAtLogin: true, isMac: false, startHidden: true })).toEqual({
      openAtLogin: true,
      args: [START_HIDDEN_ARG],
    })
  })

  it('does not add arguments without the option, or when the login item is being removed', () => {
    expect(buildLoginItemSettings({ openAtLogin: true, isMac: false, startHidden: false })).toEqual({ openAtLogin: true })
    expect(buildLoginItemSettings({ openAtLogin: false, isMac: false, startHidden: true })).toEqual({ openAtLogin: false })
  })

  it('cannot pass arguments on macOS, which detects a login launch instead', () => {
    expect(buildLoginItemSettings({ openAtLogin: true, isMac: true, startHidden: true })).toEqual({
      openAtLogin: true,
      name: 'Vicu',
    })
  })
})

describe('parseHiddenArg', () => {
  it('finds --hidden among the arguments', () => {
    expect(parseHiddenArg(['/opt/Vicu/vicu', '--hidden'])).toBe(true)
    expect(parseHiddenArg(['vicu', '--quick-entry'])).toBe(false)
    expect(parseHiddenArg(['vicu', '--hidden-ish'])).toBe(false)
  })
})

describe('shouldStartHidden', () => {
  const base = { hiddenArg: false, openedAtLogin: false, startHiddenSetting: false, isMac: false, canComeBack: true }

  it('starts hidden for the --hidden argument when there is a tray to bring it back', () => {
    expect(shouldStartHidden({ ...base, hiddenArg: true })).toBe(true)
  })

  it('does not hide without a way back (no tray on Windows and Linux)', () => {
    expect(shouldStartHidden({ ...base, hiddenArg: true, canComeBack: false })).toBe(false)
  })

  it('shows the window for a normal launch, even with the setting on', () => {
    expect(shouldStartHidden({ ...base, startHiddenSetting: true })).toBe(false)
  })

  it('on macOS hides a login launch when the setting is on', () => {
    expect(shouldStartHidden({ ...base, isMac: true, openedAtLogin: true, startHiddenSetting: true })).toBe(true)
    expect(shouldStartHidden({ ...base, isMac: true, openedAtLogin: true, startHiddenSetting: false })).toBe(false)
    expect(shouldStartHidden({ ...base, isMac: true, openedAtLogin: false, startHiddenSetting: true })).toBe(false)
  })

  it('ignores the macOS login signal elsewhere', () => {
    expect(shouldStartHidden({ ...base, isMac: false, openedAtLogin: true, startHiddenSetting: true })).toBe(false)
  })
})

describe('startWindowState', () => {
  const base = {
    hiddenArg: false,
    openedAtLogin: false,
    startHiddenSetting: false,
    isMac: false,
    canComeBack: true,
    minimizeOnClose: false,
  }

  it('shows the window on a normal start', () => {
    expect(startWindowState(base)).toBe('shown')
    expect(startWindowState({ ...base, minimizeOnClose: true })).toBe('shown')
  })

  it('starts hidden in the tray with --hidden', () => {
    expect(startWindowState({ ...base, hiddenArg: true })).toBe('hidden')
  })

  it('starts minimized instead when the close button minimizes, so the taskbar badge is there', () => {
    expect(startWindowState({ ...base, hiddenArg: true, minimizeOnClose: true })).toBe('minimized')
  })

  it('starts minimized without a tray icon, because the taskbar button brings it back', () => {
    expect(startWindowState({ ...base, hiddenArg: true, minimizeOnClose: true, canComeBack: false })).toBe('minimized')
    expect(startWindowState({ ...base, hiddenArg: true, canComeBack: false })).toBe('shown')
  })

  it('keeps the macOS rule: the close action does not apply there', () => {
    const mac = { ...base, isMac: true, openedAtLogin: true, startHiddenSetting: true, minimizeOnClose: true }
    expect(startWindowState(mac)).toBe('hidden')
  })
})

