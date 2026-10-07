import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({
  dir: '',
  failRename: false,
  renames: 0,
  fetch: null as null | (() => Promise<Response>),
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  // No OS keychain in tests: the store keeps tokens as "plain:<token>".
  safeStorage: { isEncryptionAvailable: () => false },
  net: { fetch: () => state.fetch!() },
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      state.renames++
      if (state.failRename) throw new Error('EIO: simulated write failure')
      return actual.renameSync(from, to)
    },
  }
})

async function modules() {
  vi.resetModules()
  return {
    store: await import('../auth/token-store'),
    renewal: await import('../auth/jwt-renewal'),
  }
}

function refreshResponse(body: unknown, refreshToken?: string, status = 200): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (refreshToken) headers.append('Set-Cookie', `vikunja_refresh_token=${refreshToken}; Path=/; HttpOnly`)
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers })
}

describe('renewing the JWT (F2)', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-jwt-renewal-'))
    state.failRename = false
    state.renames = 0
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(state.dir, { recursive: true, force: true })
  })

  const authFile = () => readFileSync(join(state.dir, 'auth.json'), 'utf-8')

  async function signedIn() {
    const m = await modules()
    m.store.storeRefreshToken('refresh_old')
    state.renames = 0
    return m
  }

  it('saves the new JWT and the rotated refresh token together, in one write', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse({ token: 'jwt_new' }, 'refresh_new')

    expect(await renewal.renewJWT('https://tasks.example.com')).toBe('jwt_new')

    expect(state.renames).toBe(1)
    expect(store.getJWT()).toBe('jwt_new')
    expect(store.getRefreshToken()).toBe('refresh_new')
    const onDisk = JSON.parse(authFile()) as { jwt: string; refresh_token: string }
    expect(onDisk.jwt).toBe('plain:jwt_new')
    expect(onDisk.refresh_token).toBe('plain:refresh_new')
  })

  it('does not strand the rotated refresh token when the file cannot be written: this session keeps it', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse({ token: 'jwt_new' }, 'refresh_new')
    state.failRename = true

    // The server has rotated the token; the renewal still succeeds and the next one can use it.
    expect(await renewal.renewJWT('https://tasks.example.com')).toBe('jwt_new')

    expect(store.getRefreshToken()).toBe('refresh_new')
    expect(store.getJWT()).toBe('jwt_new')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save the renewed session'), expect.any(String))
    expect(JSON.parse(authFile()).refresh_token).toBe('plain:refresh_old')

    // The next write to the store saves what was kept in memory.
    state.failRename = false
    store.storeProviderKey('provider')
    const onDisk = JSON.parse(authFile()) as { jwt: string; refresh_token: string }
    expect(onDisk.refresh_token).toBe('plain:refresh_new')
    expect(onDisk.jwt).toBe('plain:jwt_new')
  })

  it('saves the rotated refresh token even when the response has no usable JWT', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse({}, 'refresh_new')

    await expect(renewal.renewJWT('https://tasks.example.com')).rejects.toMatchObject({ kind: 'server-error' })

    expect(store.getRefreshToken()).toBe('refresh_new')
    expect(JSON.parse(authFile()).refresh_token).toBe('plain:refresh_new')
  })

  it('saves the rotated refresh token when the body is not JSON, and reports it', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse('<html>', 'refresh_new')

    await expect(renewal.renewJWT('https://tasks.example.com')).rejects.toThrow(/not valid JSON/)

    expect(store.getRefreshToken()).toBe('refresh_new')
  })

  it('keeps the old refresh token when the server did not rotate it', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse({ token: 'jwt_new' })

    await renewal.renewJWT('https://tasks.example.com')

    expect(store.getRefreshToken()).toBe('refresh_old')
    expect(store.getJWT()).toBe('jwt_new')
  })

  it('writes nothing when the refresh is refused', async () => {
    const { store, renewal } = await signedIn()
    state.fetch = async () => refreshResponse('nope', 'refresh_new', 401)

    await expect(renewal.renewJWT('https://tasks.example.com')).rejects.toMatchObject({ kind: 'unauthorized' })

    expect(state.renames).toBe(0)
    expect(store.getRefreshToken()).toBe('refresh_old')
  })
})

describe('storeRenewedSession', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-renewed-session-'))
    state.failRename = false
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('reports whether the tokens reached the disk', async () => {
    const { store } = await modules()
    expect(store.storeRenewedSession({ jwt: 'a', refreshToken: 'b' })).toBe(true)
    state.failRename = true
    expect(store.storeRenewedSession({ jwt: 'c', refreshToken: 'd' })).toBe(false)
    expect(store.getJWT()).toBe('c')
    expect(store.getRefreshToken()).toBe('d')
  })

  it('keeps the other secrets in the store', async () => {
    const { store } = await modules()
    store.storeAPIToken('tk_api', 1_900_000_000)
    store.storeRenewedSession({ jwt: 'j', refreshToken: 'r' })
    expect(store.getAPIToken()).toBe('tk_api')
  })
})
