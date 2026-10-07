import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A scripted stand-in for Electron's net.request. Each request is recorded; the test decides
// when and how the "server" answers.
interface FakeRequest extends EventEmitter {
  method: string
  url: string
  headers: Record<string, string>
  body: Buffer[]
  aborted: boolean
  setHeader(name: string, value: string): void
  write(chunk: Buffer | string): void
  end(chunk?: Buffer | string): void
  abort(): void
  respond(status: number, headers?: Record<string, string>): FakeResponse
}
type FakeResponse = EventEmitter & { statusCode: number; headers: Record<string, string> }

const net = vi.hoisted(() => ({
  requests: [] as unknown[],
  onRequest: null as null | ((req: unknown) => void),
}))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class Req extends Emitter {
    headers: Record<string, string> = {}
    body: Buffer[] = []
    aborted = false
    constructor(public method: string, public url: string) {
      super()
    }
    setHeader(name: string, value: string): void {
      this.headers[name] = value
    }
    write(chunk: Buffer | string): void {
      this.body.push(Buffer.from(chunk))
    }
    end(chunk?: Buffer | string): void {
      if (chunk !== undefined) this.write(chunk)
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
    BrowserWindow: { getAllWindows: () => [] },
  }
})

vi.mock('../config', () => ({
  loadConfig: () => ({ vikunja_url: 'https://tasks.example.com', auth_method: 'api_token', api_token: 'tk' }),
}))
vi.mock('../auth/auth-manager', () => ({
  authManager: { getTokenSync: () => 'tk', getToken: async () => 'tk' },
}))
vi.mock('../auth/token-store', () => ({ getAPIToken: () => 'tk' }))

async function loadClient() {
  vi.resetModules()
  net.requests.length = 0
  net.onRequest = null
  return await import('../api-client')
}

function sent(): FakeRequest[] {
  return net.requests as FakeRequest[]
}

/** Answer every request through `handler`; it gets the request once it has been ended. */
function serve(handler: (req: FakeRequest) => void): void {
  net.onRequest = (req) => {
    queueMicrotask(() => handler(req as FakeRequest))
  }
}

function answerJson(req: FakeRequest, status: number, payload: unknown): void {
  const res = req.respond(status, { 'content-type': 'application/json' })
  res.emit('data', Buffer.from(JSON.stringify(payload)))
  res.emit('end')
}

describe('uploadTaskAttachment', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('refuses a file above the max_file_size from /info without sending it', async () => {
    const client = await loadClient()
    serve((req) => {
      if (req.url.endsWith('/api/v2/info')) answerJson(req, 200, { max_file_size: '1MB' })
      else answerJson(req, 201, {})
    })

    const result = await client.uploadTaskAttachment(7, Buffer.alloc(2_000_000), 'big.bin', 'application/octet-stream')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('too large')
      expect(result.error).toContain('2 MB')
      expect(result.error).toContain('1 MB')
      // 422, so a queued upload that is too large is dropped by the offline replay instead of retried.
      expect(result.statusCode).toBe(422)
    }
    expect(sent().filter((r) => r.method === 'POST')).toHaveLength(0)
  })

  it('sends a file that fits, and asks /info only once for several uploads', async () => {
    const client = await loadClient()
    serve((req) => {
      if (req.url.endsWith('/api/v2/info')) answerJson(req, 200, { max_file_size: '1MB' })
      else answerJson(req, 201, { id: 1 })
    })

    const a = await client.uploadTaskAttachment(7, Buffer.alloc(1000), 'a.txt', 'text/plain')
    const b = await client.uploadTaskAttachment(7, Buffer.alloc(1000), 'b.txt', 'text/plain')

    expect(a.success && b.success).toBe(true)
    expect(sent().filter((r) => r.url.endsWith('/api/v2/info'))).toHaveLength(1)
    expect(sent().filter((r) => r.method === 'POST')).toHaveLength(2)
  })

  it('falls back to 20 MB when /info cannot be read', async () => {
    const client = await loadClient()
    serve((req) => {
      if (req.url.endsWith('/api/v2/info')) answerJson(req, 500, { message: 'down' })
      else answerJson(req, 201, { id: 1 })
    })

    const tooBig = await client.uploadTaskAttachment(7, Buffer.alloc(21_000_000), 'big.bin', 'application/octet-stream')
    expect(tooBig.success).toBe(false)
    const fits = await client.uploadTaskAttachment(7, Buffer.alloc(1_000_000), 'ok.bin', 'application/octet-stream')
    expect(fits.success).toBe(true)
  })

  it('writes an escaped file name into the multipart body', async () => {
    const client = await loadClient()
    serve((req) => {
      if (req.url.endsWith('/api/v2/info')) answerJson(req, 200, { max_file_size: '20MB' })
      else answerJson(req, 201, { id: 1 })
    })

    await client.uploadTaskAttachment(7, Buffer.from('data'), 'evil"\r\nContent-Type: text/html\r\n\r\n.png', 'image/png')

    const post = sent().find((r) => r.method === 'POST')!
    const text = Buffer.concat(post.body).toString('latin1')
    const headerBlock = text.slice(0, text.indexOf('\r\n\r\n'))
    expect(headerBlock.split('\r\n')).toHaveLength(3) // boundary, Content-Disposition, Content-Type
    expect(headerBlock).toContain('filename="evil\\"__Content-Type: text/html____.png"')
    expect(headerBlock).toContain('Content-Type: image/png')
  })
})

describe('downloadTaskAttachment timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps going while data keeps arriving, however long the transfer takes', async () => {
    const client = await loadClient()
    serve((req) => {
      const res = req.respond(200, {})
      // 10 chunks, 40 s apart: 400 s in total, never 60 s without data.
      let sentChunks = 0
      const timer = setInterval(() => {
        res.emit('data', Buffer.alloc(1000, 1))
        sentChunks += 1
        if (sentChunks === 10) {
          clearInterval(timer)
          res.emit('end')
        }
      }, 40_000)
    })

    const pending = client.downloadTaskAttachment(1, 2)
    await vi.advanceTimersByTimeAsync(10 * 40_000 + 1000)
    const result = await pending

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.length).toBe(10_000)
  })

  it('gives up after a minute without any data', async () => {
    const client = await loadClient()
    serve((req) => {
      const res = req.respond(200, {})
      res.emit('data', Buffer.alloc(10))
      // ... and then nothing more.
    })

    const pending = client.downloadTaskAttachment(1, 2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(sent()[0].aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    const result = await pending

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('timed out')
    expect(sent()[0].aborted).toBe(true)
  })

  it('still rejects a download over the 100 MB cap', async () => {
    const client = await loadClient()
    serve((req) => {
      req.respond(200, { 'content-length': String(101 * 1024 * 1024) })
    })
    const pending = client.downloadTaskAttachment(1, 2)
    await vi.advanceTimersByTimeAsync(10)
    const result = await pending
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('100 MB')
  })
})
