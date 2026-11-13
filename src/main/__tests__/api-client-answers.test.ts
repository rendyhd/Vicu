import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOT_API_RESPONSE_MESSAGE, SESSION_ENDED_MESSAGE, isAuthError, isQueueableFailure } from '../../shared/error-classify'

// What the API client makes of an answer: a web page with 200 (C-1), a slow answer (C-11), a 401 of
// an ended session (C-12), and the session check behind a 403 (C-2).

interface FakeRequest extends EventEmitter {
  method: string
  url: string
  headers: Record<string, string>
  aborted: boolean
  respond(status: number, headers?: Record<string, string>): FakeResponse
}
type FakeResponse = EventEmitter & { statusCode: number; headers: Record<string, string> }

const net = vi.hoisted(() => ({
  requests: [] as unknown[],
  onRequest: null as null | ((req: unknown) => void),
}))
const auth = vi.hoisted(() => ({ method: 'api_token' as string }))
const windows = vi.hoisted(() => ({ sent: [] as string[] }))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class Req extends Emitter {
    headers: Record<string, string> = {}
    aborted = false
    constructor(public method: string, public url: string) {
      super()
    }
    setHeader(name: string, value: string): void {
      this.headers[name] = value
    }
    write(): void {}
    end(): void {
      net.onRequest?.(this)
    }
    abort(): void {
      this.aborted = true
    }
    respond(status: number, headers: Record<string, string> = {}): FakeResponse {
      const res = new Emitter() as FakeResponse
      res.statusCode = status
      res.headers = headers
      this.emit('response', res)
      return res
    }
  }
  return {
    net: {
      request: (options: { method: string; url: string }) => {
        const req = new Req(options.method, options.url)
        net.requests.push(req)
        return req
      },
    },
    BrowserWindow: {
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string) => windows.sent.push(channel) } }],
    },
  }
})

vi.mock('../config', () => ({
  loadConfig: () => ({ vikunja_url: 'https://tasks.example.com', auth_method: auth.method, api_token: 'tk' }),
}))
vi.mock('../auth/auth-manager', () => ({
  authManager: {
    getTokenSync: () => 'jwt',
    getToken: async () => 'jwt',
  },
}))
vi.mock('../auth/token-store', () => ({ getAPIToken: () => 'tk' }))

async function loadClient() {
  vi.resetModules()
  net.requests.length = 0
  net.onRequest = null
  windows.sent.length = 0
  return await import('../api-client')
}

function answer(req: FakeRequest, status: number, body: string, type = 'application/json'): void {
  const res = req.respond(status, { 'content-type': type })
  if (body) res.emit('data', Buffer.from(body))
  res.emit('end')
}

const LOGIN_PAGE = '<!doctype html><html><body><form action="/login">Sign in</form></body></html>'

describe('a 2xx answer', () => {
  beforeEach(() => {
    auth.method = 'api_token'
  })

  it('with a web page is a failure marked notApiResponse, not a saved change', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 200, LOGIN_PAGE, 'text/html'))

    const result = await client.updateTask(5, { title: 'x' })

    expect(result).toEqual({ success: false, error: NOT_API_RESPONSE_MESSAGE, notApiResponse: true })
    if (!result.success) {
      // Queued like an unreachable server, for a change and for a create (nothing reached Vikunja).
      expect(isQueueableFailure(result, 'change')).toBe(true)
      expect(isQueueableFailure(result, 'create')).toBe(true)
    }
  })

  it('with an empty body stays a success', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 204, ''))

    expect(await client.deleteTask(5)).toEqual({ success: true, data: null })
  })

  it('with a web page fails a list instead of throwing', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 200, LOGIN_PAGE, 'text/html'))

    await expect(client.fetchLabels()).resolves.toMatchObject({ success: false, notApiResponse: true })
    await expect(client.fetchTasks({ page: 1 })).resolves.toMatchObject({ success: false, notApiResponse: true })
  })

  it('reads JSON as before', () => {
    return loadClient().then((client) => {
      expect(client.readSuccessBody('{"id":3}')).toEqual({ success: true, data: { id: 3 } })
      expect(client.readSuccessBody('  \n')).toEqual({ success: true, data: null })
      expect(client.readSuccessBody('<html>')).toMatchObject({ success: false, notApiResponse: true })
    })
  })
})

describe('the request time limit', () => {
  beforeEach(() => {
    auth.method = 'api_token'
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is on time without data, so a slow but moving answer arrives', async () => {
    const client = await loadClient()
    net.onRequest = (req) => {
      const r = req as FakeRequest
      const res = r.respond(200, { 'content-type': 'application/json' })
      const body = JSON.stringify({ id: 9, title: 'x'.repeat(50) })
      let i = 0
      const step = () => {
        if (i >= body.length) {
          res.emit('end')
          return
        }
        res.emit('data', Buffer.from(body.slice(i, i + 10)))
        i += 10
        setTimeout(step, 6_000)
      }
      setTimeout(step, 6_000)
    }

    const pending = client.fetchTaskById(9)
    await vi.advanceTimersByTimeAsync(120_000)
    await expect(pending).resolves.toMatchObject({ success: true, data: { id: 9 } })
  })

  it('fails after ten seconds without an answer, with a message read as a network problem', async () => {
    const client = await loadClient()
    net.onRequest = () => {}

    const pending = client.fetchTaskById(9)
    await vi.advanceTimersByTimeAsync(10_001)
    const result = await pending
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('timed out')
      expect(isQueueableFailure(result, 'change')).toBe(true)
    }
    expect((net.requests[0] as FakeRequest).aborted).toBe(true)
  })
})

describe('a 401', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('of a password or OIDC session says the session ended and asks to sign in, once per burst', async () => {
    auth.method = 'oidc'
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 401, JSON.stringify({ message: 'Unauthorized', code: 1 })))

    const first = await client.fetchTaskById(1)
    const second = await client.updateTask(1, { title: 'x' })

    expect(first).toMatchObject({ success: false, statusCode: 401, error: SESSION_ENDED_MESSAGE })
    expect(second).toMatchObject({ success: false, statusCode: 401, error: SESSION_ENDED_MESSAGE })
    if (!first.success) expect(isAuthError(first.error)).toBe(true)
    expect(windows.sent.filter((c) => c === 'auth-required')).toHaveLength(1)
  })

  it('asks again once the quiet minute has passed', async () => {
    auth.method = 'password'
    vi.useFakeTimers()
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 401, JSON.stringify({ message: 'Unauthorized', code: 1 })))

    await client.fetchTaskById(1)
    vi.setSystemTime(Date.now() + 61_000)
    await client.fetchTaskById(1)

    expect(windows.sent.filter((c) => c === 'auth-required')).toHaveLength(2)
  })

  it('of an expired session is retried once with a fresh token before it asks', async () => {
    auth.method = 'oidc'
    const client = await loadClient()
    let calls = 0
    net.onRequest = (req) =>
      queueMicrotask(() => {
        calls++
        if (calls === 1) answer(req as FakeRequest, 401, JSON.stringify({ message: 'expired', code: 11 }))
        else answer(req as FakeRequest, 200, JSON.stringify({ id: 1 }))
      })

    expect(await client.fetchTaskById(1)).toEqual({ success: true, data: { id: 1 } })
    expect(windows.sent).toHaveLength(0)
  })

  it('of an API token keeps the token message and raises no sign-in prompt', async () => {
    auth.method = 'api_token'
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 401, JSON.stringify({ message: 'Unauthorized', code: 1 })))

    const result = await client.fetchTaskById(1)

    expect(result).toMatchObject({ success: false, statusCode: 401 })
    if (!result.success) expect(result.error).toContain('API token is invalid or expired')
    expect(windows.sent).toHaveLength(0)
  })
})

describe('connectionState', () => {
  beforeEach(() => {
    auth.method = 'oidc'
  })

  it('works when the project list is read', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 200, '[]'))
    expect(await client.connectionState()).toBe('works')
  })

  it('is refused when the project list is refused', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => answer(req as FakeRequest, 401, '{"code":11}'))
    expect(await client.connectionState()).toBe('refused')
  })

  it('is unknown without an answer', async () => {
    const client = await loadClient()
    net.onRequest = (req) => queueMicrotask(() => (req as FakeRequest).emit('error', new Error('net::ERR_INTERNET_DISCONNECTED')))
    expect(await client.connectionState()).toBe('unknown')
  })
})
