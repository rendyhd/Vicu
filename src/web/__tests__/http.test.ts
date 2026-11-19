import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { isConnectionError, isRetriableError, NOT_API_RESPONSE_MESSAGE } from '../../shared/error-classify'
import { request, requestBinary, requestMultipart } from '../host/http'

// The web side of `@host/http` against a real HTTP server: the same answers must read the same
// way as on the desktop (src/main/api-answers.ts does the reading for both), and a failure must
// classify the way the rest of the app expects.

let server: Server
let base = ''
const seen: Array<{ method: string; url: string; auth: string; type: string; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1')
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? ''), type: String(req.headers['content-type'] ?? ''), body })
      const send = (status: number, type: string, text: string | Buffer): void => {
        res.writeHead(status, { 'Content-Type': type })
        res.end(text)
      }
      switch (req.url) {
        case '/json': return send(200, 'application/json', JSON.stringify({ id: 7, title: 'A task' }))
        case '/empty': return send(204, 'application/json', '')
        case '/page': return send(200, 'text/html', '<html><body>Sign in to the network</body></html>')
        case '/refused': return send(403, 'application/json', JSON.stringify({ code: 3004, message: 'You need to have read access' }))
        case '/blocked': return send(403, 'text/html', '<html><body>Blocked by the firewall</body></html>')
        case '/broken': return send(500, 'application/json', JSON.stringify({ message: 'database is locked' }))
        case '/bytes': return send(200, 'application/octet-stream', Buffer.from([1, 2, 3, 250]))
        case '/cut':
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' })
          res.write('{"id":')
          return void setTimeout(() => res.destroy(), 20)
        case '/upload': return send(201, 'application/json', JSON.stringify({ success: [{ id: 1 }], errors: null }))
        default: return send(404, 'application/json', JSON.stringify({ message: 'Not found' }))
      }
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((done) => server.close(done))
})

describe('the web transport', () => {
  it('reads a JSON answer and sends the token and the body', async () => {
    const result = await request<{ id: number }>('POST', `${base}/json`, 'secret-token', { title: 'A task' })
    expect(result).toEqual({ success: true, data: { id: 7, title: 'A task' } })
    const sent = seen.at(-1)
    expect(sent).toMatchObject({ method: 'POST', auth: 'Bearer secret-token', type: 'application/json', body: '{"title":"A task"}' })
  })

  it('sends a merge patch with its own content type', async () => {
    await request('PATCH', `${base}/json`, 't', { done: true }, 'application/merge-patch+json')
    expect(seen.at(-1)?.type).toBe('application/merge-patch+json')
  })

  it('reads an empty 2xx as a success', async () => {
    expect((await request('DELETE', `${base}/empty`, 't')).success).toBe(true)
  })

  it('reads a web page with a 2xx status as "not the API", which is retriable', async () => {
    const result = await request('GET', `${base}/page`, 't')
    expect(result).toMatchObject({ success: false, error: NOT_API_RESPONSE_MESSAGE, notApiResponse: true })
  })

  it('keeps the status of a refusal the server wrote itself', async () => {
    const result = await request('GET', `${base}/refused`, 't')
    expect(result).toMatchObject({ success: false, statusCode: 403 })
  })

  it('gives a block page with a 4xx status no status code, so no rule about a 403 applies', async () => {
    const result = await request('GET', `${base}/blocked`, 't')
    expect(result.success).toBe(false)
    expect(result).toMatchObject({ notApiResponse: true })
    expect((result as { statusCode?: number }).statusCode).toBeUndefined()
  })

  it('keeps a 5xx as the server\'s answer', async () => {
    expect(await request('GET', `${base}/broken`, 't')).toMatchObject({ success: false, statusCode: 500 })
  })

  it('says the server could not be reached when nothing answers, without claiming nothing was sent', async () => {
    const closed = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const port = (closed.address() as AddressInfo).port
    await new Promise((done) => closed.close(done))
    const result = await request('GET', `http://127.0.0.1:${port}/json`, 't')
    expect(result.success).toBe(false)
    const error = (result as { error: string }).error
    expect(isRetriableError(error)).toBe(true)
    // A browser cannot tell a refused connection from a request that was sent and lost.
    expect(isConnectionError(error)).toBe(false)
  })

  it('reads an answer that breaks off as cut off: retriable, and not a connection error', async () => {
    const result = await request('GET', `${base}/cut`, 't')
    expect(result.success).toBe(false)
    const error = (result as { error: string }).error
    expect(isRetriableError(error)).toBe(true)
    expect(isConnectionError(error)).toBe(false)
  })

  it('refuses an address that is not http or https', async () => {
    expect((await request('GET', 'file:///etc/passwd', 't')).success).toBe(false)
  })

  it('downloads bytes', async () => {
    const result = await requestBinary(`${base}/bytes`, 't')
    expect(result.success && [...result.data]).toEqual([1, 2, 3, 250])
  })

  it('uploads a file as the form field Vikunja reads', async () => {
    const result = await requestMultipart('PUT', `${base}/upload`, 't', new Uint8Array([104, 105]), 'note "1".txt', 'text/plain')
    expect(result.success).toBe(true)
    const sent = seen.at(-1)
    expect(sent?.type).toMatch(/^multipart\/form-data; boundary=/)
    expect(sent?.body).toContain('name="files"')
    expect(sent?.body).toContain('hi')
  })
})
