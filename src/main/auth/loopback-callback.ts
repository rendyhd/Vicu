/**
 * The loopback listener of the browser sign-in (RFC 8252 section 7.3), free of Electron so it can be
 * tested. It accepts one redirect on 127.0.0.1, answers the browser with a short page, and hands the
 * authorization code over only when the `state` matches the login that started it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { interpretRedirect, type RedirectWording } from './oidc-url'

export interface LoopbackCallbackOptions {
  /** 0 picks a free port (tests). */
  port: number
  path: string
  expectedState: string
  timeoutMs: number
  signal?: AbortSignal
  /** How a provider's error is worded (the calendar sign-in is not an OIDC login). */
  wording?: RedirectWording
}

/** The provider's error from the redirect (`error`, `error_description`), for a caller to classify. */
export class ProviderRedirectError extends Error {
  constructor(message: string, readonly error: string, readonly description?: string) {
    super(message)
    this.name = 'ProviderRedirectError'
  }
}

export interface LoopbackCallback {
  /** The redirect URI to send to the identity provider, with the port actually bound. */
  redirectUri: string
  /** The authorization code, once the browser has been redirected here. */
  code: Promise<string>
  /** Stops listening; a pending `code` is rejected. */
  close: () => void
}

export class BrowserSignInCancelledError extends Error {
  constructor() {
    super('Sign-in in the browser was cancelled')
    this.name = 'BrowserSignInCancelledError'
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** The page the browser shows after the redirect. Self-contained: no script, no outside resources. */
export function callbackPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:Canvas;color:CanvasText}
main{max-width:28rem;padding:2rem 1.5rem;text-align:center}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{margin:0;line-height:1.5;opacity:.8}
</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`
}

function send(res: ServerResponse, status: number, html: string, onSent?: () => void): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    'Referrer-Policy': 'no-referrer',
  })
  res.end(html, onSent)
}

function listenError(err: NodeJS.ErrnoException, port: number): Error {
  if (err.code === 'EADDRINUSE') {
    return new Error(
      `Browser sign-in needs port ${port} on this computer, but another program is using it. Close that program and try again.`,
    )
  }
  return new Error(`Could not start browser sign-in: ${err.message}`)
}

/**
 * Starts listening and resolves once the port is bound. The returned `code` settles once: with the
 * code, with the provider's error, on timeout, on `signal` or on `close()`. The server stops at that
 * point; only the first redirect is ever used.
 */
export function listenForCallback(options: LoopbackCallbackOptions): Promise<LoopbackCallback> {
  const { path, expectedState, timeoutMs, signal } = options
  if (signal?.aborted) return Promise.reject(new BrowserSignInCancelledError())

  let settle: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null
  const code = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject }
  })
  // A caller that never awaits `code` (it failed to open the browser, say) must not leave an
  // unhandled rejection behind when the listener is closed.
  code.catch(() => {})

  const server = createServer()
  let redirectUri = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false

  const stop = (): void => {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    server.close()
    server.closeAllConnections()
  }
  const finish = (outcome: { code: string } | { error: Error }): void => {
    if (done) return
    done = true
    if ('code' in outcome) settle!.resolve(outcome.code)
    else settle!.reject(outcome.error)
  }
  const onAbort = (): void => {
    finish({ error: new BrowserSignInCancelledError() })
    stop()
  }

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', redirectUri)
    if (req.method !== 'GET' || url.pathname !== path) {
      send(res, 404, callbackPage('Not found', 'This address only finishes a Vicu sign-in.'))
      return
    }
    if (done) {
      send(res, 410, callbackPage('Already used', 'This sign-in has already finished. Go back to Vicu.'))
      return
    }
    const state = url.searchParams.get('state')
    if (state !== null && state !== expectedState) {
      // A tab left over from an earlier attempt: answer it, but keep waiting for this one.
      send(res, 400, callbackPage('Sign-in expired', 'This page belongs to an earlier sign-in. Use the newest sign-in tab, or start again in Vicu.'))
      return
    }
    const outcome = interpretRedirect(url.toString(), redirectUri, expectedState, options.wording)
    if (outcome.kind === 'code') {
      finish({ code: outcome.code })
      send(res, 200, callbackPage('Signed in', 'You can close this tab and go back to Vicu.'), stop)
    } else if (outcome.kind === 'error') {
      finish({ error: outcome.error ? new ProviderRedirectError(outcome.message, outcome.error, outcome.description) : new Error(outcome.message) })
      send(res, 400, callbackPage('Sign-in failed', outcome.message), stop)
    } else {
      // The right path without a code or an error: not a redirect from the provider.
      send(res, 400, callbackPage('Nothing to do', 'This page did not come from a sign-in.'))
    }
  })

  return new Promise<LoopbackCallback>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => reject(listenError(err, options.port)))
    server.listen(options.port, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      redirectUri = `http://127.0.0.1:${port}${path}`
      timer = setTimeout(() => {
        finish({ error: new Error(`Sign-in in the browser was not finished within ${Math.round(timeoutMs / 60000)} minutes`) })
        stop()
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort)
      resolve({
        redirectUri,
        code,
        close: () => {
          finish({ error: new BrowserSignInCancelledError() })
          stop()
        },
      })
    })
  })
}
