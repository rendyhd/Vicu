import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ dir: '', failRename: false }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
}))

// Makes the final rename fail: the portable stand-in for a crash after the temp
// file was written but before it replaced the real file.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (state.failRename) throw new Error('EPERM: simulated rename failure')
      return actual.renameSync(from, to)
    },
  }
})

import type { AppConfig } from '../config'

/** A fresh module instance, like a new app launch (the config module caches in memory). */
async function launch() {
  vi.resetModules()
  return await import('../config')
}

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    vikunja_url: 'https://tasks.example.com',
    api_token: '',
    inbox_project_id: 5,
    theme: 'dark',
    ...overrides,
  }
}

describe('config.json persistence (D-CFG-1)', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-config-'))
    state.failRename = false
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(state.dir, { recursive: true, force: true })
  })

  const configPath = () => join(state.dir, 'config.json')
  const backupPath = () => join(state.dir, 'config.json.bak')

  it('round-trips a saved config and leaves no temp file', async () => {
    const first = await launch()
    first.saveConfig(baseConfig({ sidebar_width: 321 }))

    const second = await launch()
    expect(second.loadConfig()).toMatchObject({ vikunja_url: 'https://tasks.example.com', sidebar_width: 321 })
    expect(existsSync(configPath() + '.tmp')).toBe(false)
  })

  it('keeps fields a newer app added to custom lists through a load and save', async () => {
    const lists = [{
      id: 'a',
      name: 'Focus',
      color: '#ff8800',
      filter: {
        project_ids: [3],
        sort_by: 'due_date',
        order_by: 'asc',
        due_date_filter: 'this_week',
        include_overdue: false,
        due_in_days: 3,
      },
    }]
    writeFileSync(configPath(), JSON.stringify({ ...baseConfig(), custom_lists: lists }), 'utf-8')

    const config = await launch()
    const loaded = config.loadConfig()!
    expect(loaded.custom_lists).toEqual(lists)
    config.saveConfig(loaded)

    expect(JSON.parse(readFileSync(configPath(), 'utf-8')).custom_lists).toEqual(lists)
  })

  it('keeps the previous config as config.json.bak', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))
    config.saveConfig(baseConfig({ sidebar_width: 200 }))

    expect(JSON.parse(readFileSync(configPath(), 'utf-8')).sidebar_width).toBe(200)
    expect(JSON.parse(readFileSync(backupPath(), 'utf-8')).sidebar_width).toBe(100)
  })

  it('an interrupted write leaves the old config readable', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))

    state.failRename = true
    expect(() => config.saveConfig(baseConfig({ sidebar_width: 999 }))).toThrow(/simulated/)
    state.failRename = false

    expect(existsSync(configPath() + '.tmp')).toBe(false)
    const relaunched = await launch()
    expect(relaunched.loadConfig()?.sidebar_width).toBe(100)
  })

  it('a leftover partial temp file does not affect loading or the next save', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))
    writeFileSync(configPath() + '.tmp', '{"vikunja_url": "https://tas', 'utf-8')

    const relaunched = await launch()
    expect(relaunched.loadConfig()?.sidebar_width).toBe(100)

    relaunched.saveConfig(baseConfig({ sidebar_width: 150 }))
    expect((await launch()).loadConfig()?.sidebar_width).toBe(150)
  })

  it('loads config.json.bak, and logs it, when config.json does not parse', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100, quick_view_hotkey: 'Alt+Shift+K' }))
    config.saveConfig(baseConfig({ sidebar_width: 200, quick_view_hotkey: 'Alt+Shift+K' }))
    writeFileSync(configPath(), '{"vikunja_url": "https://tasks.exa', 'utf-8') // torn write

    const relaunched = await launch()
    const loaded = relaunched.loadConfig()

    expect(loaded).not.toBeNull()
    expect(loaded).toMatchObject({
      vikunja_url: 'https://tasks.example.com',
      sidebar_width: 100,
      quick_view_hotkey: 'Alt+Shift+K',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('config.json')
    // The main file was repaired from the backup.
    expect(JSON.parse(readFileSync(configPath(), 'utf-8')).sidebar_width).toBe(100)
  })

  it('treats a zero-length config.json like any other corrupt file', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))
    config.saveConfig(baseConfig({ sidebar_width: 200 }))
    writeFileSync(configPath(), '', 'utf-8')

    expect((await launch()).loadConfig()?.sidebar_width).toBe(100)
  })

  it('a save after corruption does not replace the good backup with the corrupt file', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))
    config.saveConfig(baseConfig({ sidebar_width: 200 }))
    writeFileSync(configPath(), 'garbage', 'utf-8')

    const relaunched = await launch()
    relaunched.saveConfig(baseConfig({ sidebar_width: 300 }))

    expect(JSON.parse(readFileSync(configPath(), 'utf-8')).sidebar_width).toBe(300)
    expect(JSON.parse(readFileSync(backupPath(), 'utf-8')).sidebar_width).toBe(100)
  })

  it('returns null when config.json is corrupt and there is no backup', async () => {
    writeFileSync(configPath(), 'garbage', 'utf-8')

    expect((await launch()).loadConfig()).toBeNull()
  })

  it('returns null when nothing was ever saved', async () => {
    expect((await launch()).loadConfig()).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('rejects JSON that is not an object', async () => {
    const config = await launch()
    config.saveConfig(baseConfig({ sidebar_width: 100 }))
    config.saveConfig(baseConfig({ sidebar_width: 200 }))
    writeFileSync(configPath(), 'null', 'utf-8')

    expect((await launch()).loadConfig()?.sidebar_width).toBe(100)
  })
})
