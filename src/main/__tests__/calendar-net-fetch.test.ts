import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { describe, expect, it } from 'vitest'
import { manualRedirectFetch, type ClientRequestLike, type IncomingLike, type RequestOptionsLike } from '../calendar/net-fetch'

// A stand-in for Electron's ClientRequest: `answer` decides what it emits once ended.
function fakeRequest(answer: (req: FakeRequest) => void) {
  const made: FakeRequest[] = []
  const request = (options: RequestOptionsLike): ClientRequestLike => {
    const req = new FakeRequest(options, answer)
    made.push(req)
    return req as unknown as ClientRequestLike
  }
  return { request, made }
}

class FakeRequest extends EventEmitter {
  headers: Record<string, string> = {}
  written: Buffer[] = []
  aborted = false
  constructor(readonly options: RequestOptionsLike, private answer: (req: FakeRequest) => void) { super() }
  setHeader(name: string, value: string) { this.headers[name] = value }
  write(chunk: Buffer) { this.written.push(chunk) }
  end() { queueMicrotask(() => this.answer(this)) }
  abort() { this.aborted = true }
}

function incoming(status: number, body: string, headers: Record<string, string | string[]> = {}): IncomingLike {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, statusMessage: 'OK', headers }) as IncomingLike
}

describe('manualRedirectFetch', () => {
  it('asks net.request not to follow and without cookies, and passes headers and body', async () => {
    const { request, made } = fakeRequest((req) => req.emit('response', incoming(207, '<ms/>', { 'content-type': 'text/xml', dav: ['1', '2'] })))
    const fetch = manualRedirectFetch(request)
    const response = await fetch('https://dav.example.com/', { method: 'propfind', headers: { Depth: '0' }, body: '<propfind/>' })
    expect(made[0].options).toEqual({ url: 'https://dav.example.com/', method: 'PROPFIND', redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    expect(made[0].headers).toEqual({ depth: '0' })
    expect(Buffer.concat(made[0].written).toString()).toBe('<propfind/>')
    expect(response.status).toBe(207)
    expect(response.headers.get('dav')).toBe('1, 2')
    expect(await response.text()).toBe('<ms/>')
  })

  it('hands a redirect back with its Location and ends the request', async () => {
    const { request, made } = fakeRequest((req) => req.emit('redirect', 301, 'GET', 'https://other.example.com/x'))
    const response = await manualRedirectFetch(request)('https://dav.example.com/')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('https://other.example.com/x')
    expect(made[0].aborted).toBe(true)
  })

  it('stops when the signal aborts', async () => {
    const { request, made } = fakeRequest(() => { /* never answers */ })
    const controller = new AbortController()
    const pending = manualRedirectFetch(request)('https://dav.example.com/', { signal: controller.signal })
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toBeTruthy()
    expect(made[0].aborted).toBe(true)
  })

  it('passes a network error on', async () => {
    const { request } = fakeRequest((req) => req.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED')))
    await expect(manualRedirectFetch(request)('https://nowhere.invalid/')).rejects.toThrow('ERR_NAME_NOT_RESOLVED')
  })
})
