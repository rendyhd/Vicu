import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { BrowserSignInCancelledError, callbackPage, listenForCallback, type LoopbackCallback } from '../auth/loopback-callback'

const PATH = '/vicu/oidc-callback'
const open: LoopbackCallback[] = []

async function listen(options: Partial<Parameters<typeof listenForCallback>[0]> = {}): Promise<LoopbackCallback> {
  const callback = await listenForCallback({ port: 0, path: PATH, expectedState: 'state-1', timeoutMs: 60_000, ...options })
  open.push(callback)
  return callback
}

afterEach(() => {
  for (const callback of open.splice(0)) callback.close()
})

describe('listenForCallback', () => {
  it('binds the loopback interface and reports the redirect URI with the bound port', async () => {
    const callback = await listen()
    expect(callback.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/vicu\/oidc-callback$/)
  })

  it('hands over the code of a redirect with the right state and thanks the browser', async () => {
    const callback = await listen()
    const res = await fetch(`${callback.redirectUri}?code=abc&state=state-1&iss=x`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await res.text()).toContain('You can close this tab')
    await expect(callback.code).resolves.toBe('abc')
  })

  it('keeps waiting when a tab from an earlier attempt arrives with another state', async () => {
    const callback = await listen()
    const stale = await fetch(`${callback.redirectUri}?code=old&state=other`)
    expect(stale.status).toBe(400)
    expect(await stale.text()).toContain('earlier sign-in')
    await fetch(`${callback.redirectUri}?code=new&state=state-1`)
    await expect(callback.code).resolves.toBe('new')
  })

  it('keeps waiting when an error arrives without the state of this login', async () => {
    const callback = await listen()
    const noState = await fetch(`${callback.redirectUri}?error=access_denied`)
    expect(noState.status).toBe(400)
    expect(await noState.text()).toContain('earlier sign-in')
    const wrongState = await fetch(`${callback.redirectUri}?error=access_denied&state=other`)
    expect(await wrongState.text()).toContain('earlier sign-in')
    await fetch(`${callback.redirectUri}?code=ok&state=state-1`)
    await expect(callback.code).resolves.toBe('ok')
  })

  it("passes the provider's error on", async () => {
    const callback = await listen()
    const res = await fetch(`${callback.redirectUri}?error=access_denied&error_description=No%20access&state=state-1`)
    expect(res.status).toBe(400)
    await expect(callback.code).rejects.toThrow('access_denied — No access')
  })

  it('ignores other paths and requests that are not a redirect', async () => {
    const callback = await listen()
    const base = new URL(callback.redirectUri)
    expect((await fetch(`${base.origin}/favicon.ico`)).status).toBe(404)
    expect((await fetch(`${callback.redirectUri}?state=state-1`)).status).toBe(400)
    expect((await fetch(callback.redirectUri, { method: 'POST' })).status).toBe(404)
    await fetch(`${callback.redirectUri}?code=c&state=state-1`)
    await expect(callback.code).resolves.toBe('c')
  })

  it('stops listening after the first redirect', async () => {
    const callback = await listen()
    await fetch(`${callback.redirectUri}?code=c&state=state-1`)
    await callback.code
    await expect(fetch(`${callback.redirectUri}?code=d&state=state-1`)).rejects.toThrow()
  })

  it('rejects on cancel and on timeout', async () => {
    const controller = new AbortController()
    const cancelled = await listen({ signal: controller.signal })
    controller.abort()
    await expect(cancelled.code).rejects.toBeInstanceOf(BrowserSignInCancelledError)

    const closed = await listen()
    closed.close()
    await expect(closed.code).rejects.toBeInstanceOf(BrowserSignInCancelledError)

    const slow = await listen({ timeoutMs: 20 })
    await expect(slow.code).rejects.toThrow('not finished')
  })

  it('explains a port that is already in use', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const { port } = blocker.address() as { port: number }
    try {
      await expect(listenForCallback({ port, path: PATH, expectedState: 's', timeoutMs: 1000 })).rejects.toThrow(
        `needs port ${port} on this computer, but another program is using it`,
      )
    } finally {
      blocker.close()
    }
  })
})

describe('callbackPage', () => {
  it('escapes what it shows', () => {
    const html = callbackPage('<b>', 'a & "b"')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('a &amp; &quot;b&quot;')
    expect(html).not.toContain('<script')
  })
})
