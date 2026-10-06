import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ dir: '', failRename: false }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  // Plaintext fallback path of the token store: no OS keychain in tests.
  safeStorage: { isEncryptionAvailable: () => false },
}))

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

async function loadStore() {
  vi.resetModules()
  return await import('../auth/token-store')
}

async function loadInstallId() {
  vi.resetModules()
  return await import('../auth/install-id')
}

describe('auth.json persistence (D-CFG-1)', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-auth-atomic-'))
    state.failRename = false
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(state.dir, { recursive: true, force: true })
  })

  const authPath = () => join(state.dir, 'auth.json')
  const backupPath = () => join(state.dir, 'auth.json.bak')

  it('keeps the session when auth.json is torn: the backup is used and logged', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 1_900_000_000)
    store.storeRefreshToken('refresh_one')
    writeFileSync(authPath(), '{"api_token": "plain:tk_o', 'utf-8')

    const relaunched = await loadStore()
    expect(relaunched.getAPIToken()).toBe('tk_one')
    expect(relaunched.getRefreshToken()).toBeNull() // only in the write that tore, not in the backup
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0][0])).toContain('auth.json')
  })

  it('keeps the previous good state as auth.json.bak', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 1_900_000_000)
    store.storeAPIToken('tk_two', 1_900_000_001)

    expect(store.getAPIToken()).toBe('tk_two')
    expect(JSON.parse(readFileSync(backupPath(), 'utf-8')).api_token).toBe('plain:tk_one')
  })

  it('an interrupted write leaves the old auth.json readable', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 1_900_000_000)

    state.failRename = true
    expect(() => store.storeAPIToken('tk_two', 1_900_000_001)).toThrow(/simulated/)
    state.failRename = false

    expect(existsSync(authPath() + '.tmp')).toBe(false)
    expect((await loadStore()).getAPIToken()).toBe('tk_one')
  })

  it('logout removes the backup too, so it cannot restore the session', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 1_900_000_000)
    store.storeAPIToken('tk_two', 1_900_000_001)
    expect(existsSync(backupPath())).toBe(true)

    store.clear()

    expect(existsSync(authPath())).toBe(false)
    expect(existsSync(backupPath())).toBe(false)
    const relaunched = await loadStore()
    expect(relaunched.hasAPIToken()).toBe(false)
    expect(relaunched.getAPIToken()).toBeNull()
  })

  it('is empty (logged out) when auth.json is corrupt and there is no backup', async () => {
    writeFileSync(authPath(), 'garbage', 'utf-8')

    const store = await loadStore()
    expect(store.hasAPIToken()).toBe(false)
  })
})

describe('install id write', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-install-id-atomic-'))
    state.failRename = false
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('writes through a temp file and leaves none behind', async () => {
    const id = (await loadInstallId()).getInstallId()

    expect(readFileSync(join(state.dir, 'install-id'), 'utf-8')).toBe(`${id}\n`)
    expect(existsSync(join(state.dir, 'install-id.tmp'))).toBe(false)
  })
})
