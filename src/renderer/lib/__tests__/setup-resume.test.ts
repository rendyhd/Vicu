import { describe, expect, it } from 'vitest'
import { setupResume } from '../setup-resume'

describe('what Setup does first in the web version', () => {
  it('goes on with the session when a sign-in came back and worked', () => {
    // The page used to stay at the sign-in choice here: the session was only tried when nothing came back.
    expect(setupResume({ providerKey: 'authentik' })).toBe('try-session')
  })

  it('tries the session when nothing came back (a first visit or a reload half way)', () => {
    expect(setupResume(null)).toBe('try-session')
  })

  it('asks for the code when the server wants one, also when it says why', () => {
    expect(setupResume({ providerKey: 'authentik', totpRequired: true })).toBe('ask-totp')
    expect(setupResume({ providerKey: 'authentik', totpRequired: true, error: 'Invalid code' })).toBe('ask-totp')
  })

  it('shows why a sign-in failed', () => {
    expect(setupResume({ providerKey: 'authentik', error: 'Sign-in failed: access_denied' })).toBe('show-error')
  })
})
