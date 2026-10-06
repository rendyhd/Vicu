import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  // Plaintext fallback path of the token store: no OS keychain in tests.
  safeStorage: { isEncryptionAvailable: () => false },
}))

async function loadStore() {
  vi.resetModules()
  return await import('../auth/token-store')
}

async function loadInstallId() {
  vi.resetModules()
  return await import('../auth/install-id')
}

describe('token store: backup token id', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-token-store-'))
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('keeps the server id and server URL with a token Vicu created', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_secret', 1_900_000_000, { id: 42, baseUrl: 'https://tasks.example.com/' })

    expect(store.getAPIToken()).toBe('tk_secret')
    expect(store.getAPITokenMeta()).toEqual({ id: 42, baseUrl: 'https://tasks.example.com' })
  })

  it('has no id for a token without metadata (user-provided, or a JWT kept as fallback)', async () => {
    const store = await loadStore()
    store.storeAPIToken('user_token', store.API_TOKEN_NO_EXPIRY)

    expect(store.getAPITokenMeta()).toBeNull()
  })

  it('drops a stale id when the stored token is replaced by one without metadata', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_first', 1_900_000_000, { id: 7, baseUrl: 'https://a.example' })
    store.storeAPIToken('tk_second', 1_900_000_001)

    expect(store.getAPITokenMeta()).toBeNull()
    expect(store.getAPIToken()).toBe('tk_second')
  })

  it('replaces the id when a new backup token is stored', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_first', 1_900_000_000, { id: 7, baseUrl: 'https://a.example' })
    store.storeAPIToken('tk_second', 1_900_000_001, { id: 8, baseUrl: 'https://a.example' })

    expect(store.getAPITokenMeta()).toEqual({ id: 8, baseUrl: 'https://a.example' })
  })

  it('records the id of an already-stored token (upgrade lookup) without touching the token', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk_legacy', 1_900_000_000)
    store.setAPITokenMeta({ id: 99, baseUrl: 'https://a.example' })

    expect(store.getAPITokenMeta()).toEqual({ id: 99, baseUrl: 'https://a.example' })
    expect(store.getAPIToken()).toBe('tk_legacy')
    expect(store.getAPITokenExpiry()).toBe(1_900_000_000)
  })

  it('does not record an id when there is no stored token', async () => {
    const store = await loadStore()
    store.setAPITokenMeta({ id: 99, baseUrl: 'https://a.example' })

    expect(store.getAPITokenMeta()).toBeNull()
  })

  it('forgets the id on logout (clear)', async () => {
    const store = await loadStore()
    store.storeAPIToken('tk', 1_900_000_000, { id: 5, baseUrl: 'https://a.example' })
    store.clear()

    expect(store.getAPITokenMeta()).toBeNull()
    expect(store.hasAPIToken()).toBe(false)
  })
})

describe('install id', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-install-id-'))
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('is generated once and survives restarts', async () => {
    const first = (await loadInstallId()).getInstallId()
    expect(first).toMatch(/^[0-9a-f]{6}$/)
    expect(readFileSync(join(state.dir, 'install-id'), 'utf-8').trim()).toBe(first)

    const second = (await loadInstallId()).getInstallId()
    expect(second).toBe(first)
  })

  it('survives logout: it does not live in auth.json', async () => {
    const id = (await loadInstallId()).getInstallId()
    const store = await loadStore()
    store.storeAPIToken('tk', 1_900_000_000)
    store.clear()

    expect(existsSync(join(state.dir, 'auth.json'))).toBe(false)
    expect((await loadInstallId()).getInstallId()).toBe(id)
  })

  it('replaces a corrupt file with a fresh valid id', async () => {
    writeFileSync(join(state.dir, 'install-id'), 'not-an-id', 'utf-8')
    const id = (await loadInstallId()).getInstallId()

    expect(id).toMatch(/^[0-9a-f]{6}$/)
    expect(readFileSync(join(state.dir, 'install-id'), 'utf-8').trim()).toBe(id)
  })
})
