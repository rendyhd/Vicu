import { describe, expect, it } from 'vitest'
import { buildAuthorizationUrl, interpretRedirect, withOfflineAccess } from '../auth/oidc-url'

const REDIRECT = 'https://tasks.example.com/auth/openid/keycloak'

describe('withOfflineAccess', () => {
  it('adds offline_access once', () => {
    expect(withOfflineAccess('openid profile email')).toBe('openid profile email offline_access')
    expect(withOfflineAccess('openid offline_access')).toBe('openid offline_access')
  })

  it('does not match a scope that merely contains the word', () => {
    expect(withOfflineAccess('openid my_offline_access_x')).toBe('openid my_offline_access_x offline_access')
  })
})

describe('buildAuthorizationUrl', () => {
  const provider = {
    auth_url: 'https://idp.example.com/realms/main/protocol/openid-connect/auth',
    client_id: 'vikunja',
    scope: 'openid profile email',
  }

  it('builds the standard authorization request', () => {
    const url = new URL(buildAuthorizationUrl(provider, REDIRECT, 'state-1'))
    expect(url.origin + url.pathname).toBe(provider.auth_url)
    expect(url.searchParams.get('client_id')).toBe('vikunja')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access')
  })

  it('keeps an auth_url that already has a query and adds to it', () => {
    const raw = buildAuthorizationUrl({ ...provider, auth_url: 'https://idp.example.com/auth?tenant=acme&prompt=login' }, REDIRECT, 's')
    const url = new URL(raw)
    expect(url.searchParams.get('tenant')).toBe('acme')
    expect(url.searchParams.get('prompt')).toBe('login')
    expect(url.searchParams.get('client_id')).toBe('vikunja')
    // One question mark only: parameters are appended, not glued on with a second `?`.
    expect(raw.split('?')).toHaveLength(2)
  })

  it('encodes a client_id that has reserved characters', () => {
    const raw = buildAuthorizationUrl({ ...provider, client_id: 'my app&redirect_uri=https://evil.example/#x' }, REDIRECT, 's')
    const url = new URL(raw)
    expect(url.searchParams.get('client_id')).toBe('my app&redirect_uri=https://evil.example/#x')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    expect(url.hash).toBe('')
  })

  it('does not let the server-provided query override the parameters Vicu sets', () => {
    const url = new URL(
      buildAuthorizationUrl({ ...provider, auth_url: 'https://idp.example.com/auth?state=attacker&response_type=token' }, REDIRECT, 'mine'),
    )
    expect(url.searchParams.getAll('state')).toEqual(['mine'])
    expect(url.searchParams.getAll('response_type')).toEqual(['code'])
  })

  it('writes spaces as %20, as encodeURIComponent did', () => {
    expect(buildAuthorizationUrl(provider, REDIRECT, 's')).toContain('scope=openid%20profile%20email%20offline_access')
  })

  it('adds extra parameters such as prompt=none for the silent sign-in', () => {
    const url = new URL(buildAuthorizationUrl(provider, REDIRECT, 's', { prompt: 'none' }))
    expect(url.searchParams.get('prompt')).toBe('none')
    expect(url.searchParams.get('state')).toBe('s')
  })

  it('rejects an auth_url that is not an http(s) URL', () => {
    expect(() => buildAuthorizationUrl({ ...provider, auth_url: 'not a url' }, REDIRECT, 's')).toThrow(/authorization/i)
    expect(() => buildAuthorizationUrl({ ...provider, auth_url: 'javascript:alert(1)' }, REDIRECT, 's')).toThrow(/authorization/i)
    expect(() => buildAuthorizationUrl({ ...provider, auth_url: 'file:///etc/passwd' }, REDIRECT, 's')).toThrow(/authorization/i)
  })
})

describe('interpretRedirect', () => {
  it('ignores navigations away from the redirect URI', () => {
    expect(interpretRedirect('https://idp.example.com/login?code=abc&state=s', REDIRECT, 's')).toEqual({ kind: 'ignore' })
    expect(interpretRedirect('https://tasks.example.com/auth/openid/other?code=abc&state=s', REDIRECT, 's')).toEqual({ kind: 'ignore' })
    expect(interpretRedirect('https://tasks.example.com/auth/openid/keycloak-2?code=abc&state=s', REDIRECT, 's')).toEqual({ kind: 'ignore' })
    expect(interpretRedirect('https://evil.example.com/auth/openid/keycloak?code=abc&state=s', REDIRECT, 's')).toEqual({ kind: 'ignore' })
    expect(interpretRedirect('not a url', REDIRECT, 's')).toEqual({ kind: 'ignore' })
  })

  it('returns the code when the state matches', () => {
    expect(interpretRedirect(`${REDIRECT}?code=abc123&state=s`, REDIRECT, 's')).toEqual({ kind: 'code', code: 'abc123' })
  })

  it('tolerates a trailing slash and extra parameters', () => {
    expect(interpretRedirect(`${REDIRECT}/?session_state=x&code=abc&state=s`, REDIRECT, 's')).toEqual({ kind: 'code', code: 'abc' })
  })

  it('rejects a code whose state does not match, with a clear message', () => {
    const result = interpretRedirect(`${REDIRECT}?code=abc&state=other`, REDIRECT, 's')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toMatch(/state/i)
      expect(result.message).toMatch(/try again/i)
      expect(result.message).not.toContain('abc')
    }
  })

  it('rejects a code that comes without any state', () => {
    expect(interpretRedirect(`${REDIRECT}?code=abc`, REDIRECT, 's').kind).toBe('error')
    expect(interpretRedirect(`${REDIRECT}?code=abc&state=`, REDIRECT, 's').kind).toBe('error')
  })

  it('reports an error from the provider', () => {
    const result = interpretRedirect(`${REDIRECT}?error=access_denied&error_description=User%20said%20no&state=s`, REDIRECT, 's')
    expect(result).toEqual({ kind: 'error', message: 'OIDC login failed: access_denied — User said no' })
  })

  it('reports an error without a description', () => {
    const result = interpretRedirect(`${REDIRECT}?error=server_error`, REDIRECT, 's')
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toContain('server_error')
  })

  it('uses the wording of the silent sign-in when asked to', () => {
    const silent = { errorPrefix: 'Silent reauth failed', defaultErrorDescription: 'session expired' }
    expect(interpretRedirect(`${REDIRECT}?error=login_required`, REDIRECT, 's', silent)).toEqual({
      kind: 'error',
      message: 'Silent reauth failed: login_required — session expired',
    })
  })

  it('keeps waiting when the redirect has neither code nor error', () => {
    expect(interpretRedirect(`${REDIRECT}?state=s`, REDIRECT, 's')).toEqual({ kind: 'ignore' })
  })
})
