import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Signing out of the web version. The cookie that renews a session stays in the browser, so the
// session may only be forgotten once the server has ended it: a sign-out the server never heard of
// would leave the next person at the computer one step from the account.

const jwtFor = (secondsFromNow: number): string => {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow }))
  return `header.${payload}.signature`
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Session = typeof import('../session')
let session: Session
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

beforeEach(async () => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('window', { location: { origin: 'https://vicu.test' } })
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => {} })
  vi.stubGlobal('fetch', fetchMock)
  session = await import('../session')
})

afterEach(() => {
  session.clearSession(false)
  vi.unstubAllGlobals()
})

async function signIn(token = jwtFor(600)): Promise<void> {
  fetchMock.mockResolvedValueOnce(json(200, { token }))
  expect((await session.loginWithPassword('ana', 'secret')).success).toBe(true)
}

const calls = (): string[] => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}`)

describe('signing out', () => {
  it('ends the session on the server and then forgets it', async () => {
    await signIn()
    fetchMock.mockResolvedValueOnce(json(200, { message: 'Successfully logged out.', oidc_logout_url: '' }))
    expect(await session.logoutSession()).toEqual({ ended: true })
    expect(calls().at(-1)).toBe('POST /api/v2/logout')
    expect(session.sessionTokenSync()).toBeNull()
  })

  it('says where the identity provider ends its own session', async () => {
    await signIn()
    fetchMock.mockResolvedValueOnce(json(200, { oidc_logout_url: 'https://id.example.org/end-session?x=1' }))
    expect(await session.logoutSession()).toEqual({ ended: true, providerSignOutUrl: 'https://id.example.org/end-session?x=1' })
  })

  it('does not follow a provider address that is not a web address', async () => {
    await signIn()
    fetchMock.mockResolvedValueOnce(json(200, { oidc_logout_url: 'javascript:alert(1)' }))
    expect(await session.logoutSession()).toEqual({ ended: true })
  })

  it('stays signed in when the server cannot be reached', async () => {
    await signIn()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await session.logoutSession()).toEqual({ ended: false })
    expect(session.sessionTokenSync()).not.toBeNull()
  })

  it('stays signed in when the server fails, or something else answers in its place', async () => {
    await signIn()
    fetchMock.mockResolvedValueOnce(json(502, { message: 'Bad gateway' }))
    expect(await session.logoutSession()).toEqual({ ended: false })
    fetchMock.mockResolvedValueOnce(new Response('<html>Sign in to the network</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await session.logoutSession()).toEqual({ ended: false })
    expect(session.sessionTokenSync()).not.toBeNull()
  })

  it('renews first when the token in memory has run out, so the server accepts the sign-out', async () => {
    await signIn(jwtFor(5))
    expect(session.sessionTokenSync()).toBeNull()
    fetchMock.mockResolvedValueOnce(json(200, { token: jwtFor(600) }))
    fetchMock.mockResolvedValueOnce(json(200, { oidc_logout_url: '' }))
    expect(await session.logoutSession()).toEqual({ ended: true })
    expect(calls().slice(-2)).toEqual(['POST /api/v1/user/token/refresh', 'POST /api/v2/logout'])
    const authorization = (fetchMock.mock.calls.at(-1)?.[1]?.headers as Record<string, string>).Authorization
    expect(authorization).toMatch(/^Bearer header\./)
  })

  it('has nothing to end when the server already ended the session', async () => {
    await signIn(jwtFor(5))
    fetchMock.mockResolvedValueOnce(json(401, { code: 11, message: 'Invalid or expired refresh token' }))
    expect(await session.logoutSession()).toEqual({ ended: true })
    expect(calls().at(-1)).toBe('POST /api/v1/user/token/refresh')
  })

  it('stays signed in when the renewal cannot reach the server either', async () => {
    await signIn(jwtFor(5))
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await session.logoutSession()).toEqual({ ended: false })
  })
})
