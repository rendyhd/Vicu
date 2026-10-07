import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({
  dir: '',
  reads: 0,
  decrypts: 0,
  failDecrypt: false,
  failRename: false,
  readError: false,
}))

// A keychain that does a little work: "encrypts" by wrapping and counts every decryption.
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => {
      state.decrypts += 1
      if (state.failDecrypt) throw new Error('keychain locked')
      return buffer.toString('utf-8').slice(4)
    },
  },
}))

vi.mock('../atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../atomic-file')>()
  return {
    ...actual,
    readFileWithBackup: <T,>(path: string, parse: (raw: string) => T) => {
      state.reads += 1
      if (state.readError) return null
      return actual.readFileWithBackup(path, parse)
    },
  }
})

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

describe('token store keeps auth.json in memory (D-AUTH-3)', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-token-cache-'))
    state.reads = 0
    state.decrypts = 0
    state.failDecrypt = false
    state.failRename = false
    state.readError = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  const authPath = () => join(state.dir, 'auth.json')

  it('reads the file once and decrypts each secret once, however many token checks follow', async () => {
    const first = await loadStore()
    first.storeAPIToken('tk_secret', 4_102_444_800)
    first.storeJWT('a.b.c')

    // A restart: nothing in memory yet.
    const store = await loadStore()
    state.reads = 0
    state.decrypts = 0

    for (let i = 0; i < 50; i++) {
      expect(store.isJWTExpired()).toBe(true)
      expect(store.getJWT()).toBe('a.b.c')
      expect(store.getAPIToken()).toBe('tk_secret')
      expect(store.hasAPIToken()).toBe(true)
      expect(store.isAPITokenExpired()).toBe(false)
      expect(store.getBestToken()).toBe('tk_secret')
    }

    expect(state.reads).toBe(1)
    expect(state.decrypts).toBe(2) // the JWT and the API token, once each
  })

  it('serves a token it just stored without reading the file or decrypting again', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 4_102_444_800)
    store.storeRefreshToken('refresh_one')

    expect(store.getAPIToken()).toBe('tk_one')
    expect(store.getRefreshToken()).toBe('refresh_one')
    expect(state.decrypts).toBe(0)
    // Storing reads the file at most once (the first store call), never for the reads above.
    expect(state.reads).toBeLessThanOrEqual(1)
  })

  it('returns the new value after a write: the memory copy is replaced, not left stale', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 4_102_444_800)
    expect(store.getAPIToken()).toBe('tk_one')

    store.storeAPIToken('tk_two', 4_102_444_801)
    expect(store.getAPIToken()).toBe('tk_two')
    expect(store.getAPITokenExpiry()).toBe(4_102_444_801)

    // What is on disk agrees (a restart reads the same).
    const restarted = await loadStore()
    expect(restarted.getAPIToken()).toBe('tk_two')
  })

  it('forgets everything on clear, in memory as well as on disk', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 4_102_444_800)
    store.storeRefreshToken('refresh_one')
    expect(store.getAPIToken()).toBe('tk_one')

    store.clear()

    expect(store.getAPIToken()).toBeNull()
    expect(store.getRefreshToken()).toBeNull()
    expect(store.hasAPIToken()).toBe(false)
    expect(store.getBestToken()).toBeNull()
    // Signing in again after a logout works.
    store.storeAPIToken('tk_next', 4_102_444_800)
    expect(store.getAPIToken()).toBe('tk_next')
  })

  it('keeps the previous state in memory when a write fails', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_one', 4_102_444_800)

    state.failRename = true
    expect(() => store.storeAPIToken('tk_two', 4_102_444_801)).toThrow(/simulated/)
    state.failRename = false

    expect(store.getAPIToken()).toBe('tk_one')
    expect(store.getAPITokenExpiry()).toBe(4_102_444_800)
    // And the failed change did not leak into the next successful write either.
    store.storeRefreshToken('refresh_one')
    expect(store.getAPIToken()).toBe('tk_one')
  })

  it('does not remember a decryption that failed: it is tried again later', async () => {
    const first = await loadStore()
    first.storeAPIToken('tk_one', 4_102_444_800)

    const store = await loadStore()
    state.failDecrypt = true
    expect(store.getAPIToken()).toBeNull()
    expect(store.getAPIToken()).toBeNull()

    state.failDecrypt = false
    expect(store.getAPIToken()).toBe('tk_one')
    expect(store.getAPIToken()).toBe('tk_one')
    expect(state.decrypts).toBe(3) // two failures, one success
  })

  it('a file that exists but cannot be read is not remembered as "signed out"', async () => {
    const first = await loadStore()
    first.storeAPIToken('tk_one', 4_102_444_800)

    const store = await loadStore()
    state.readError = true // an antivirus scan holds the file for a moment
    expect(store.getAPIToken()).toBeNull()

    state.readError = false
    expect(store.getAPIToken()).toBe('tk_one')
  })

  it('a missing file is a settled answer and is not re-read on every check', async () => {
    const store = await loadStore()
    expect(store.getAPIToken()).toBeNull()
    expect(store.getJWT()).toBeNull()
    expect(store.hasAPIToken()).toBe(false)
    expect(state.reads).toBe(1)
  })

  it('still recovers from a torn file through the backup, once', async () => {
    const first = await loadStore()
    first.storeAPIToken('tk_one', 4_102_444_800)
    first.storeRefreshToken('refresh_one')
    writeFileSync(authPath(), '{"api_token": "enc', 'utf-8')

    const store = await loadStore()
    expect(store.getAPIToken()).toBe('tk_one')
    expect(store.getAPIToken()).toBe('tk_one')
    expect(JSON.parse(readFileSync(authPath(), 'utf-8')).api_token).toBeTruthy()
  })
})
