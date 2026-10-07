import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({
  dir: '',
  fetch: undefined as unknown as Mock<(...args: any[]) => any>,
}))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
  net: { fetch: (...args: unknown[]) => state.fetch(...args) },
  BrowserWindow: class {},
  screen: {},
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  hostname: () => 'MY-LAPTOP',
}))

const BASE = 'https://tasks.example.com'

interface Call {
  method: string
  url: string
  auth: string | null
  body: unknown
}

interface FakeServer {
  tokens: { id: number; title: string; expires_at?: string }[]
  nextTokenId: number
  deleteStatus: number
  calls: Call[]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function installFakeServer(server: FakeServer): void {
  state.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    server.calls.push({ method, url, auth: headers.Authorization ?? null, body })

    if (method === 'GET' && url === `${BASE}/api/v2/routes`) {
      return json({ tasks: { read_all: {}, update: {} }, projects: { read_all: {} } })
    }
    if (method === 'POST' && url === `${BASE}/api/v2/tokens`) {
      const id = server.nextTokenId++
      server.tokens.push({ id, title: body.title, expires_at: body.expires_at })
      return json({ id, token: `tk_${id}`, title: body.title }, 201)
    }
    if (method === 'GET' && url.startsWith(`${BASE}/api/v2/tokens?`)) {
      return json({ items: server.tokens, total_pages: 1 })
    }
    const del = /\/api\/v2\/tokens\/(\d+)$/.exec(url)
    if (method === 'DELETE' && del) {
      if (server.deleteStatus < 300) {
        server.tokens = server.tokens.filter((t) => t.id !== Number(del[1]))
      }
      return new Response(null, { status: server.deleteStatus })
    }
    return json({}, 404)
  })
}

function deletedIds(server: FakeServer): number[] {
  return server.calls
    .filter((c) => c.method === 'DELETE')
    .map((c) => Number(/\/tokens\/(\d+)$/.exec(c.url)![1]))
    .sort((a, b) => a - b)
}

async function load() {
  vi.resetModules()
  const store = await import('../auth/token-store')
  const login = await import('../auth/oidc-login')
  const installId = (await import('../auth/install-id')).getInstallId()
  return { store, login, installId }
}

describe('backup API token lifecycle', () => {
  let server: FakeServer

  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-backup-flow-'))
    server = { tokens: [], nextTokenId: 50, deleteStatus: 204, calls: [] }
    installFakeServer(server)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  describe('creation', () => {
    it('titles the token with a per-install suffix and stores its server id', async () => {
      const { store, login, installId } = await load()
      await login.createBackupAPIToken(BASE, 'jwt_1')

      const create = server.calls.find((c) => c.method === 'POST' && c.url.endsWith('/tokens'))!
      expect((create.body as { title: string }).title).toBe(`Vicu — MY-LAPTOP [${installId}]`)
      expect(store.getAPIToken()).toBe('tk_50')
      expect(store.getAPITokenMeta()).toEqual({ id: 50, baseUrl: BASE })
    })

    it('deletes only this install\'s stale tokens and the one it replaces', async () => {
      const { store, login, installId } = await load()
      // This install already holds token 9 (stored id) from an earlier login.
      server.tokens = [
        { id: 9, title: `Vicu — MY-LAPTOP [${installId}]` },
        { id: 11, title: `Vicu — OLD-NAME [${installId}]` }, // this install, before a rename
        { id: 12, title: 'Vicu — MY-LAPTOP [ffffff]' }, // another machine, same host name
        { id: 13, title: 'Vicu — MY-LAPTOP' }, // legacy title, owner unknown
        { id: 14, title: 'My own token' },
        { id: 15, title: 'Vicu — Pixel 8 [a1b2c3]' }, // a phone
      ]
      store.storeAPIToken('tk_9', 1_900_000_000, { id: 9, baseUrl: BASE })

      await login.createBackupAPIToken(BASE, 'jwt_1')
      await vi.waitFor(() => expect(deletedIds(server)).toEqual([9, 11]))

      expect(server.tokens.map((t) => t.id).sort((a, b) => a - b)).toEqual([12, 13, 14, 15, 50])
    })

    it('does not use a stored id from another server', async () => {
      const { store, login } = await load()
      server.tokens = [{ id: 9, title: 'My own token' }]
      store.storeAPIToken('tk_9', 1_900_000_000, { id: 9, baseUrl: 'https://other.example.com' })

      await login.createBackupAPIToken(BASE, 'jwt_1')
      await vi.waitFor(() => expect(server.calls.some((c) => c.method === 'GET' && c.url.includes('/tokens?'))).toBe(true))
      await new Promise((r) => setTimeout(r, 20))

      expect(deletedIds(server)).toEqual([])
    })

    it('revokes the token an older version created, matched by title and expiry', async () => {
      const { store, login } = await load()
      const expiry = 1_900_000_000
      server.tokens = [
        { id: 20, title: 'Vicu — MY-LAPTOP', expires_at: new Date(expiry * 1000).toISOString() }, // ours
        { id: 21, title: 'Vicu — MY-LAPTOP', expires_at: new Date((expiry + 3600) * 1000).toISOString() }, // other machine
      ]
      store.storeAPIToken('tk_legacy', expiry) // no id: stored by the old version

      await login.createBackupAPIToken(BASE, 'jwt_1')
      await vi.waitFor(() => expect(deletedIds(server)).toEqual([20]))
    })
  })

  describe('revocation on logout', () => {
    it('deletes the stored token with the given credential', async () => {
      const { store, login } = await load()
      server.tokens = [{ id: 50, title: 'Vicu — MY-LAPTOP [abcdef]' }]
      store.storeAPIToken('tk_50', 1_900_000_000, { id: 50, baseUrl: BASE })

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).toBe(true)

      const del = server.calls.find((c) => c.method === 'DELETE')!
      expect(del.url).toBe(`${BASE}/api/v2/tokens/50`)
      expect(del.auth).toBe('Bearer jwt_live')
      expect(server.tokens).toEqual([])
    })

    it('treats an already-deleted token as revoked', async () => {
      const { store, login } = await load()
      server.deleteStatus = 404
      store.storeAPIToken('tk_50', 1_900_000_000, { id: 50, baseUrl: BASE })

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).toBe(true)
    })

    it('reports failure without throwing when the server rejects the delete', async () => {
      const { store, login } = await load()
      server.deleteStatus = 401
      store.storeAPIToken('tk_50', 1_900_000_000, { id: 50, baseUrl: BASE })

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_expired')).toBe(false)
    })

    it('reports failure without throwing when the network is down', async () => {
      const { store, login } = await load()
      state.fetch = vi.fn(async () => {
        throw new TypeError('net::ERR_INTERNET_DISCONNECTED')
      })
      store.storeAPIToken('tk_50', 1_900_000_000, { id: 50, baseUrl: BASE })

      await expect(login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).resolves.toBe(false)
    })

    it('never touches a user-provided API token', async () => {
      const { store, login } = await load()
      store.storeAPIToken('user_token', store.API_TOKEN_NO_EXPIRY)

      expect(await login.revokeStoredBackupAPIToken(BASE, 'user_token')).toBe(false)
      expect(server.calls).toEqual([])
    })

    it('never uses an id recorded for another server', async () => {
      const { store, login } = await load()
      store.storeAPIToken('tk_50', 1_900_000_000, { id: 50, baseUrl: 'https://other.example.com' })

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).toBe(false)
      expect(server.calls).toEqual([])
    })

    it('finds and revokes an old token that has no recorded id', async () => {
      const { store, login } = await load()
      const expiry = 1_900_000_000
      server.tokens = [
        { id: 20, title: 'Vicu — MY-LAPTOP', expires_at: new Date(expiry * 1000).toISOString() },
        { id: 21, title: 'Vicu — MY-LAPTOP', expires_at: new Date((expiry + 3600) * 1000).toISOString() },
      ]
      store.storeAPIToken('tk_legacy', expiry)

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).toBe(true)
      expect(deletedIds(server)).toEqual([20])
    })

    it('leaves everything alone when the old token cannot be identified', async () => {
      const { store, login } = await load()
      server.tokens = [{ id: 21, title: 'Vicu — MY-LAPTOP', expires_at: new Date(1_900_003_600 * 1000).toISOString() }]
      store.storeAPIToken('tk_legacy', 1_900_000_000)

      expect(await login.revokeStoredBackupAPIToken(BASE, 'jwt_live')).toBe(false)
      expect(deletedIds(server)).toEqual([])
    })
  })

  describe('adopting the id of an old token', () => {
    it('records the id once so logout can revoke it later', async () => {
      const { store, login } = await load()
      const expiry = 1_900_000_000
      server.tokens = [{ id: 20, title: 'Vicu — MY-LAPTOP', expires_at: new Date(expiry * 1000).toISOString() }]
      store.storeAPIToken('tk_legacy', expiry)

      await login.adoptLegacyBackupTokenId(BASE, 'jwt_live')
      expect(store.getAPITokenMeta()).toEqual({ id: 20, baseUrl: BASE })

      const listCalls = () => server.calls.filter((c) => c.url.includes('/tokens?')).length
      expect(listCalls()).toBe(1)
      await login.adoptLegacyBackupTokenId(BASE, 'jwt_live')
      expect(listCalls()).toBe(1)
    })

    it('does not repeat a failed lookup within the same run', async () => {
      const { store, login } = await load()
      store.storeAPIToken('tk_legacy', 1_900_000_000)

      await login.adoptLegacyBackupTokenId(BASE, 'jwt_live')
      await login.adoptLegacyBackupTokenId(BASE, 'jwt_live')

      expect(server.calls.filter((c) => c.url.includes('/tokens?'))).toHaveLength(1)
      expect(store.getAPITokenMeta()).toBeNull()
    })
  })
})
