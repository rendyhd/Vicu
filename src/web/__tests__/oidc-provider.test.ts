import { describe, expect, it } from 'vitest'
import { resolveOidcProvider } from '../handlers'

const providers = [
  { key: 'authentik', name: 'Authentik' },
  { key: 'keycloak', name: 'Keycloak' },
]

describe('picking the OIDC provider in the web host', () => {
  it('uses the explicitly requested provider when offered', () => {
    expect(resolveOidcProvider(providers, 'keycloak', 'authentik')).toEqual(providers[1])
  })

  it('returns null when an explicitly requested provider is no longer offered', () => {
    expect(resolveOidcProvider(providers, 'deleted', 'authentik')).toBeNull()
  })

  it('falls back to the remembered provider when no key is passed (ReauthView)', () => {
    expect(resolveOidcProvider(providers, '', 'keycloak')).toEqual(providers[1])
  })

  it('falls back to the first provider when no key is passed and the remembered one is missing', () => {
    expect(resolveOidcProvider(providers, '', 'deleted')).toEqual(providers[0])
    expect(resolveOidcProvider(providers, '', null)).toEqual(providers[0])
  })

  it('returns null when the server offers no providers', () => {
    expect(resolveOidcProvider([], '', 'authentik')).toBeNull()
  })
})
