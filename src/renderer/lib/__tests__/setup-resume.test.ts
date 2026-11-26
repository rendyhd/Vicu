import { describe, expect, it } from 'vitest'
import { resolveSetupInbox, setupResume } from '../setup-resume'

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

describe('resolving the Inbox after sign-in', () => {
  const projects = [
    { id: 1, title: 'Inbox' },
    { id: 4, title: 'Personal' },
    { id: 9, title: 'Capture' },
  ]

  it('skips the Inbox question when the account already has a synced Inbox that exists', () => {
    expect(resolveSetupInbox(projects, { inboxProjectId: 9, defaultProjectId: 4 })).toEqual({
      kind: 'synced',
      inboxProjectId: 9,
    })
  })

  it('asks when the synced Inbox no longer exists, preselecting the server default', () => {
    expect(resolveSetupInbox(projects, { inboxProjectId: 999, defaultProjectId: 4 })).toEqual({
      kind: 'ask',
      preselectedId: 4,
    })
  })

  it('asks when no synced Inbox is set, preselecting Vikunja default then Inbox by name', () => {
    expect(resolveSetupInbox(projects, { inboxProjectId: null, defaultProjectId: 4 })).toEqual({
      kind: 'ask',
      preselectedId: 4,
    })
    expect(resolveSetupInbox(projects, { inboxProjectId: null, defaultProjectId: null })).toEqual({
      kind: 'ask',
      preselectedId: 1,
    })
    expect(resolveSetupInbox(projects, null)).toEqual({
      kind: 'ask',
      preselectedId: 1,
    })
  })

  it('falls back to 0 when no synced Inbox, default project, or project named Inbox exists', () => {
    expect(resolveSetupInbox([{ id: 4, title: 'Personal' }], null)).toEqual({
      kind: 'ask',
      preselectedId: 0,
    })
  })
})
