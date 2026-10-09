// Shared helpers for the ui-verify scripts: paths, the test-server API client, test credentials
// and the API token, and local-calendar helpers. Nothing in here prints a secret.
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(HERE, '..', '..')
/** Git-ignored: test credentials, the API token, seed ids and the throwaway app profiles (VICU_UI_LOCAL moves it). */
export const LOCAL = process.env.VICU_UI_LOCAL ? resolve(process.env.VICU_UI_LOCAL) : join(HERE, '.local')
/** Git-ignored: captures and result lines, one folder per run. */
export const OUT = join(HERE, 'out')

export const SERVER_URL = (process.env.VICU_TEST_SERVER ?? 'http://127.0.0.1:3456').replace(/\/+$/, '')
export const API_URL = `${SERVER_URL}/api/v2`
export const CONTAINER = process.env.VICU_TEST_CONTAINER ?? 'vicu-test-vikunja'
export const TEST_USERNAME = 'uiverify'
export const TEST_EMAIL = 'uiverify@example.test'
export const TOKEN_TITLE = 'vicu ui-verify'

// --- Files in .local -----------------------------------------------------------------------

export const localPath = (...parts) => join(LOCAL, ...parts)

export function readLocalJson(name) {
  const file = localPath(name)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

export function writeLocal(name, content) {
  const file = localPath(name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', { mode: 0o600 })
}

export function readSeedIds() {
  const ids = readLocalJson('seed-ids.json')
  if (!ids) throw new Error('scripts/ui-verify/.local/seed-ids.json is missing: run `node scripts/ui-verify/seed.mjs` first.')
  return ids
}

export function readApiToken() {
  const file = localPath('api-token.txt')
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : ''
}

// --- Local calendar ------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')

/** Local YYYY-MM-DD of today plus `offset` days. */
export function localDate(offset = 0, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO instant of local wall-clock `hh:mm:ss` on today plus `dayOffset` days. */
export function at(dayOffset, hh = 23, mm = 59, ss = 59) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hh, mm, ss, 0).toISOString()
}

/** A due date without a time is stored as local 23:59:59 (cross-app semantics section 1.1). */
export const dateOnly = (dayOffset) => at(dayOffset, 23, 59, 59)

/**
 * The next calendar day (from tomorrow on) that falls on `weekday` (0 = Sunday ... 6 = Saturday),
 * as a Date at local midnight. "The coming Saturday" in the scenarios.
 */
export function comingWeekday(weekday, from = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const delta = ((weekday - base.getDay() + 7) % 7) || 7
  base.setDate(base.getDate() + delta)
  return base
}

// --- Server API ----------------------------------------------------------------------------

export async function serverUp() {
  try {
    const res = await fetch(`${SERVER_URL}/api/v1/info`, { signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

export async function requireServer() {
  if (await serverUp()) return
  throw new Error(
    `The test server does not answer at ${SERVER_URL}. Start it as described in scripts/ui-verify/README.md ` +
      `(docker start ${CONTAINER}, or the docker run recipe).`,
  )
}

/** A small API v2 client. Errors carry the method, path and status, never the request body. */
export function createApi(token = '') {
  const state = { token }

  async function call(method, path, body, contentType = 'application/json') {
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': contentType,
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text()
    if (res.status === 304) return null
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
      err.status = res.status
      throw err
    }
    return text ? JSON.parse(text) : null
  }

  /** Every item of a collection (API v2 envelope `{ items, total_pages }`). */
  async function list(path, params = {}) {
    const all = []
    for (let page = 1; page < 1000; page++) {
      const query = new URLSearchParams({ per_page: '50', ...params, page: String(page) })
      const sep = path.includes('?') ? '&' : '?'
      const body = await call('GET', `${path}${sep}${query}`)
      const items = Array.isArray(body) ? body : (body?.items ?? [])
      all.push(...items)
      const totalPages = Array.isArray(body) ? 1 : (body?.total_pages ?? 1)
      if (items.length === 0 || page >= totalPages) break
    }
    return all
  }

  return {
    call,
    list,
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    put: (path, body) => call('PUT', path, body),
    patch: (path, body) => call('PATCH', path, body, 'application/merge-patch+json'),
    del: (path) => call('DELETE', path),
    setToken(next) {
      state.token = next
    },
    get token() {
      return state.token
    },
  }
}

// --- Test user and token -------------------------------------------------------------------

function vikunjaCli(args) {
  try {
    return execFileSync('docker', ['exec', CONTAINER, '/app/vikunja/vikunja', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      timeout: 60000,
    })
  } catch (e) {
    // The command line carries the password, so only the program's own output is reported.
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(-4).join(' | ')
    const err = new Error(`vikunja ${args[0]} ${args[1] ?? ''} failed in container ${CONTAINER}: ${out || e.code || 'no output'}`)
    err.output = out
    throw err
  }
}

/** The test user's credentials; made up and stored in .local on the first run. */
export function loadOrCreateCredentials() {
  const existing = readLocalJson('credentials.json')
  if (existing?.username && existing?.password) return existing
  const creds = { username: TEST_USERNAME, email: TEST_EMAIL, password: randomBytes(18).toString('base64url') }
  writeLocal('credentials.json', creds)
  return creds
}

async function tryLogin(creds) {
  try {
    const res = await createApi().post('/login', { username: creds.username, password: creds.password, long_token: true })
    return res?.token ?? null
  } catch (e) {
    // Wrong username or password answers 403 (code 1011) from API v2; older servers use 401.
    if ([400, 401, 403, 404, 412].includes(e.status)) return null
    throw e
  }
}

/**
 * Makes sure the test user exists and its stored password works, then returns a login JWT. A new
 * user is created through the Vikunja CLI in the container; an existing user with another
 * password (credentials file lost) gets the stored password set directly.
 */
export async function ensureUserAndLogin() {
  await requireServer()
  const creds = loadOrCreateCredentials()
  let jwt = await tryLogin(creds)
  if (jwt) return { jwt, creds }

  let created = true
  try {
    vikunjaCli(['user', 'create', '-u', creds.username, '-e', creds.email ?? TEST_EMAIL, '-p', creds.password])
  } catch (e) {
    created = false
    if (!/exist|already|taken|duplicate/i.test(e.output ?? '')) throw e
  }
  if (!created) {
    const table = vikunjaCli(['user', 'list'])
    const row = table.split('\n').find((line) => new RegExp(`\\b${creds.username}\\b`).test(line))
    const id = row?.match(/(\d+)/)?.[1]
    if (!id) throw new Error(`The user ${creds.username} exists but its id could not be read from "user list".`)
    vikunjaCli(['user', 'reset-password', id, '--direct', '-p', creds.password])
  }
  jwt = await tryLogin(creds)
  if (!jwt) throw new Error(`Could not log in as ${creds.username} after creating it.`)
  return { jwt, creds }
}

/**
 * Returns a working full-access API token (kept in .local/api-token.txt). A stored token that
 * the server still accepts is reused; otherwise old tokens with this tool's title are deleted and
 * a new one is created. Needs a login JWT because tokens cannot manage tokens.
 */
export async function ensureApiToken(jwt) {
  const stored = readApiToken()
  if (stored) {
    try {
      await createApi(stored).get('/projects?per_page=1')
      return stored
    } catch (e) {
      if (e.status !== 401 && e.status !== 403) throw e
    }
  }
  const api = createApi(jwt)
  try {
    for (const t of await api.list('/tokens')) {
      if (t.title === TOKEN_TITLE) await api.del(`/tokens/${t.id}`)
    }
  } catch {
    // Listing tokens is best effort; a leftover token is harmless.
  }
  const routes = await api.get('/routes')
  const permissions = Object.fromEntries(Object.entries(routes).map(([group, perms]) => [group, Object.keys(perms)]))
  const expires = new Date(Date.now() + 30 * 86400e3).toISOString()
  const created = await api.post('/tokens', { title: TOKEN_TITLE, expires_at: expires, permissions })
  writeLocal('api-token.txt', created.token)
  return created.token
}
