// The calendar HTTP's base in the app (http.ts): a fetch over Electron's net.request, which follows
// the system proxy like net.fetch, but hands a redirect back instead of following it. net.fetch
// cannot: asked for `redirect: 'manual'` it fails with "Redirect was cancelled" and the Location is
// lost. http.ts follows the redirect itself and decides whether the sign-in goes along.
//
// Kept free of an Electron import (the service passes `net.request`), so it can be tested with a
// fake request.

import { Readable } from 'stream'
import type { FetchLike } from './http'

/** The part of Electron's IncomingMessage read here (it is a Readable stream). */
export interface IncomingLike extends Readable {
  statusCode: number
  statusMessage: string
  headers: Record<string, string | string[]>
}

/** The part of Electron's ClientRequest used here. */
export interface ClientRequestLike {
  setHeader(name: string, value: string): void
  on(event: 'response', listener: (response: IncomingLike) => void): this
  on(event: 'redirect', listener: (statusCode: number, method: string, redirectUrl: string) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  write(chunk: Buffer): void
  end(): void
  abort(): void
}

export interface RequestOptionsLike {
  url: string
  method: string
  redirect: 'manual'
  credentials: 'omit'
  useSessionCookies: false
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/** A fetch that answers a redirect with its 3xx status and a Location header, never following it. */
export function manualRedirectFetch(request: (options: RequestOptionsLike) => ClientRequestLike): FetchLike {
  return async (url, init = {}) => {
    const method = String(init.method ?? 'GET').toUpperCase()
    const body = init.body == null ? null : Buffer.from(await new Response(init.body).arrayBuffer())
    const signal = init.signal ?? undefined
    if (signal?.aborted) throw abortError(signal)

    return new Promise<Response>((resolve, reject) => {
      const req = request({ url, method, redirect: 'manual', credentials: 'omit', useSessionCookies: false })
      let settled = false
      let incoming: IncomingLike | null = null
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }
      // Stays on after the answer came: the time limit also covers reading the body.
      const onAbort = () => {
        req.abort()
        incoming?.destroy(abortError(signal!) as Error)
        settle(() => reject(abortError(signal!)))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      req.on('redirect', (statusCode, _method, redirectUrl) => {
        // Not followed: the request ends here and the caller decides.
        req.abort()
        settle(() => resolve(new Response(null, { status: statusCode, headers: { location: redirectUrl } })))
      })
      req.on('response', (response) => {
        incoming = response
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
        const nullBody = NULL_BODY_STATUSES.has(response.statusCode) || method === 'HEAD'
        if (nullBody) response.resume()
        const stream = nullBody ? null : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>)
        settle(() => resolve(new Response(stream, { status: response.statusCode, statusText: response.statusMessage, headers })))
      })
      req.on('error', (error) => settle(() => reject(error)))

      new Headers(init.headers ?? {}).forEach((value, name) => req.setHeader(name, value))
      if (body && body.length > 0) req.write(body)
      req.end()
    })
  }
}
