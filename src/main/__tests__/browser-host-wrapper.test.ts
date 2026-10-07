import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildPosixWrapper,
  buildWindowsWrapper,
  hostRegistryKey,
  registryAddArgs,
  registryDeleteArgs,
  resolveHostExecutable,
} from '../browser-host-wrapper'

describe('resolveHostExecutable', () => {
  it('uses the AppImage file on Linux, because the mount under execPath disappears on exit', () => {
    expect(
      resolveHostExecutable({ platform: 'linux', execPath: '/tmp/.mount_ViCuab12/vicu', appImage: '/home/u/Vicu-1.8.1-x64.AppImage' }),
    ).toBe('/home/u/Vicu-1.8.1-x64.AppImage')
  })

  it('uses the running binary everywhere else', () => {
    expect(resolveHostExecutable({ platform: 'linux', execPath: '/opt/Vicu/vicu' })).toBe('/opt/Vicu/vicu')
    expect(resolveHostExecutable({ platform: 'win32', execPath: 'C:\\Vicu\\Vicu.exe', appImage: '/ignored' })).toBe('C:\\Vicu\\Vicu.exe')
    expect(resolveHostExecutable({ platform: 'darwin', execPath: '/Applications/Vicu.app/Contents/MacOS/Vicu' })).toBe(
      '/Applications/Vicu.app/Contents/MacOS/Vicu',
    )
  })

  it('ignores an empty APPIMAGE value', () => {
    expect(resolveHostExecutable({ platform: 'linux', execPath: '/opt/Vicu/vicu', appImage: '' })).toBe('/opt/Vicu/vicu')
  })
})

describe('buildWindowsWrapper', () => {
  const rt = {
    execPath: 'C:\\Program Files\\Vicu\\Vicu.exe',
    bridgePath: 'C:\\Program Files\\Vicu\\resources\\resources\\native-messaging-host\\vicu-bridge.js',
  }

  it('runs the bridge with the app binary as Node, so no system Node.js is needed', () => {
    expect(buildWindowsWrapper(rt)).toBe(
      '@echo off\r\n' +
        'set ELECTRON_RUN_AS_NODE=1\r\n' +
        '"C:\\Program Files\\Vicu\\Vicu.exe" "C:\\Program Files\\Vicu\\resources\\resources\\native-messaging-host\\vicu-bridge.js"\r\n',
    )
  })

  it('does not call a bare node command', () => {
    expect(buildWindowsWrapper(rt)).not.toMatch(/^\s*node\b/im)
  })

  it('doubles percent signs so cmd does not expand them', () => {
    const out = buildWindowsWrapper({ ...rt, execPath: 'C:\\50%OFF\\Vicu.exe' })
    expect(out).toContain('"C:\\50%%OFF\\Vicu.exe"')
  })

  it('switches cmd to UTF-8 only when a path has non-ASCII characters', () => {
    expect(buildWindowsWrapper(rt)).not.toContain('chcp')
    const out = buildWindowsWrapper({ ...rt, execPath: 'C:\\Users\\José\\AppData\\Local\\Programs\\Vicu\\Vicu.exe' })
    const lines = out.split('\r\n')
    expect(lines[0]).toBe('@echo off')
    expect(lines[1]).toBe('chcp 65001 >nul')
    expect(out).toContain('José')
  })

  it('refuses paths that cannot be quoted safely', () => {
    expect(() => buildWindowsWrapper({ ...rt, execPath: 'C:\\a"b\\Vicu.exe' })).toThrow()
    expect(() => buildWindowsWrapper({ ...rt, bridgePath: 'C:\\a\r\nb\\vicu-bridge.js' })).toThrow()
    expect(() => buildWindowsWrapper({ ...rt, execPath: '' })).toThrow()
  })
})

describe('buildPosixWrapper', () => {
  it('execs the app binary as Node with the bridge script', () => {
    expect(
      buildPosixWrapper({
        execPath: '/Applications/Vicu.app/Contents/MacOS/Vicu',
        bridgePath: '/Applications/Vicu.app/Contents/Resources/resources/native-messaging-host/vicu-bridge.js',
      }),
    ).toBe(
      '#!/bin/sh\n' +
        'export ELECTRON_RUN_AS_NODE=1\n' +
        "exec '/Applications/Vicu.app/Contents/MacOS/Vicu' '/Applications/Vicu.app/Contents/Resources/resources/native-messaging-host/vicu-bridge.js'\n",
    )
  })

  it('does not depend on which or a bare node', () => {
    const out = buildPosixWrapper({ execPath: '/opt/Vicu/vicu', bridgePath: '/opt/Vicu/vicu-bridge.js' })
    expect(out).not.toContain('which')
    expect(out).not.toMatch(/\bexec\s+(\/usr\/bin\/env\s+)?node\b/)
  })

  it('single-quotes paths and escapes embedded quotes', () => {
    const out = buildPosixWrapper({ execPath: "/home/o'neil/Vicu.AppImage", bridgePath: '/home/o neil/$HOME/vicu-bridge.js' })
    expect(out).toContain(`exec '/home/o'\\''neil/Vicu.AppImage' '/home/o neil/$HOME/vicu-bridge.js'`)
  })

  it('accepts a double quote, which is legal in a POSIX path and safe inside single quotes', () => {
    const out = buildPosixWrapper({ execPath: '/opt/a"b/vicu', bridgePath: '/opt/vicu-bridge.js' })
    expect(out).toContain(`exec '/opt/a"b/vicu' '/opt/vicu-bridge.js'`)
  })

  it('refuses empty paths and control characters', () => {
    expect(() => buildPosixWrapper({ execPath: '', bridgePath: '/b.js' })).toThrow()
    expect(() => buildPosixWrapper({ execPath: '/a\nrm -rf /', bridgePath: '/b.js' })).toThrow()
  })
})

describe('registry arguments (no shell string involved)', () => {
  it('builds the key for each browser and host', () => {
    expect(hostRegistryKey('chrome', 'com.vicu.browser')).toBe('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.vicu.browser')
    expect(hostRegistryKey('firefox', 'com.vikunja_quick_entry.browser')).toBe(
      'HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.vikunja_quick_entry.browser',
    )
  })

  it('passes the manifest path as one argument, spaces and quotes included', () => {
    const key = hostRegistryKey('chrome', 'com.vicu.browser')
    const manifest = 'C:\\Users\\Rendy "R" Jansen\\AppData\\Roaming\\vicu\\com.vicu.browser.json'
    expect(registryAddArgs(key, manifest)).toEqual(['add', key, '/ve', '/d', manifest, '/f'])
  })

  it('deletes a key without prompting', () => {
    const key = hostRegistryKey('firefox', 'com.vicu.browser')
    expect(registryDeleteArgs(key)).toEqual(['delete', key, '/f'])
  })
})

describe('browser-host-registration.ts source', () => {
  const source = readFileSync(resolve(__dirname, '..', 'browser-host-registration.ts'), 'utf8')

  it('no longer builds shell command strings', () => {
    expect(source).not.toContain('execSync')
    expect(source).not.toMatch(/\breg (add|delete)\b/)
  })

  it('no longer looks up a system node', () => {
    expect(source).not.toContain('which node')
  })
})
