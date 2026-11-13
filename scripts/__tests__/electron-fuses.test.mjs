import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FuseV1Options } from '@electron/fuses'
import { afterEach, describe, expect, it } from 'vitest'
import { afterPack, fuseConfig, fuseMismatches } from '../electron-fuses.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ON = 49
const OFF = 48

describe('fuseConfig', () => {
  it('turns off every way to run other code in the Mac app, and pins it to the checked app.asar', () => {
    const config = fuseConfig('darwin')
    expect(config[FuseV1Options.RunAsNode]).toBe(false)
    expect(config[FuseV1Options.EnableNodeOptionsEnvironmentVariable]).toBe(false)
    expect(config[FuseV1Options.EnableNodeCliInspectArguments]).toBe(false)
    expect(config[FuseV1Options.OnlyLoadAppFromAsar]).toBe(true)
    expect(config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]).toBe(true)
    // An arm64 Mac does not start a binary whose ad-hoc signature no longer matches.
    expect(config.resetAdHocDarwinSignature).toBe(true)
  })

  it('leaves the fuses it has no reason to touch', () => {
    const config = fuseConfig('darwin')
    expect(config[FuseV1Options.EnableCookieEncryption]).toBeUndefined()
    expect(config[FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]).toBeUndefined()
    expect(config[FuseV1Options.GrantFileProtocolExtraPrivileges]).toBeUndefined()
  })

  it('leaves Windows and Linux alone while their browser bridge runs the app as Node', () => {
    expect(fuseConfig('win32')).toBeNull()
    expect(fuseConfig('linux')).toBeNull()
  })
})

describe('fuseMismatches', () => {
  const wire = {
    version: '1',
    [FuseV1Options.RunAsNode]: OFF,
    [FuseV1Options.EnableCookieEncryption]: OFF,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: OFF,
    [FuseV1Options.EnableNodeCliInspectArguments]: OFF,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: ON,
    [FuseV1Options.OnlyLoadAppFromAsar]: ON,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: OFF,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: ON,
  }

  it('finds nothing when the binary holds the fuses asked for', () => {
    expect(fuseMismatches(fuseConfig('darwin'), wire)).toEqual([])
  })

  it('names each fuse the binary does not hold', () => {
    const stock = { ...wire, [FuseV1Options.RunAsNode]: ON, [FuseV1Options.OnlyLoadAppFromAsar]: OFF }
    expect(fuseMismatches(fuseConfig('darwin'), stock)).toEqual(['RunAsNode should be off', 'OnlyLoadAppFromAsar should be on'])
  })
})

describe('afterPack', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  function context(platform) {
    dir = mkdtempSync(join(tmpdir(), 'vicu-fuses-'))
    const calls = []
    return {
      calls,
      electronPlatformName: platform,
      appOutDir: dir,
      packager: {
        appInfo: { productFilename: 'Vicu' },
        addElectronFuses: async (ctx, config) => { calls.push(config) },
      },
    }
  }

  it('changes nothing on Windows and Linux', async () => {
    for (const platform of ['win32', 'linux']) {
      const ctx = context(platform)
      await afterPack(ctx)
      expect(ctx.calls).toEqual([])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a Mac app without the browser link tool, before any fuse is set', async () => {
    const ctx = context('darwin')
    mkdirSync(join(dir, 'Vicu.app', 'Contents', 'Resources', 'resources'), { recursive: true })
    await expect(afterPack(ctx)).rejects.toThrow(/bridge:helper/)
    expect(ctx.calls).toEqual([])
  })

  it('sets the fuses of a Mac app that has the tool, then fails when they cannot be read back', async () => {
    const ctx = context('darwin')
    const bridge = join(dir, 'Vicu.app', 'Contents', 'Resources', 'resources', 'bridge')
    mkdirSync(bridge, { recursive: true })
    writeFileSync(join(bridge, 'vicu-bridge-macos'), '')
    // The fake packager sets nothing and there is no Electron binary to read: the check must not pass.
    await expect(afterPack(ctx)).rejects.toThrow()
    expect(ctx.calls).toEqual([fuseConfig('darwin')])
  })
})

describe('packaging', () => {
  it('runs the hook from electron-builder.yml', () => {
    expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).toMatch(/^afterPack: \.\/scripts\/electron-fuses\.mjs$/m)
  })

  it('builds the browser link tool in both Mac dist scripts', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const name of ['dist:mac', 'dist:mac:publish']) {
      expect(scripts[name]).toContain('npm run bridge:helper')
      expect(scripts[name].indexOf('bridge:helper')).toBeLessThan(scripts[name].indexOf('electron-builder'))
    }
  })
})
