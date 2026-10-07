import { describe, expect, it, vi } from 'vitest'
import { checkUnsyncedWork, signOutWarning, type SignOutCheckDeps } from '../sign-out-check'
import type { AppConfig } from '../vikunja-types'
import type { OfflineQueueSnapshot } from '../../../shared/offline-queue-types'

const snapshot = (pending: number): OfflineQueueSnapshot => ({
  pending: Array.from({ length: pending }, (_, i) => ({
    id: `a${i}`, type: 'update', summary: `Update "Task ${i}"`, createdAt: '2026-10-07T08:00:00.000Z', attempts: 0,
  })) as OfflineQueueSnapshot['pending'],
  failed: [],
  replaying: false,
  authProblem: null,
  loadStatus: 'ok',
})

const config = (overrides: Partial<AppConfig> = {}, dirty = false): AppConfig => ({
  vikunja_url: 'https://tasks.example.com',
  custom_lists_sync: { device_id: 'd', document: { version: 1, lists: {}, order: { ids: [] } } as never, dirty },
  ...overrides,
}) as AppConfig

function deps(overrides: Partial<SignOutCheckDeps> = {}): SignOutCheckDeps {
  return {
    syncCustomLists: vi.fn(async () => ({ state: 'idle' as const })),
    replayNow: vi.fn(async () => ({ success: true as const, data: null })),
    snapshot: vi.fn(async () => ({ success: true as const, data: snapshot(0) })),
    getConfig: vi.fn(async () => config()),
    timeoutMs: 20,
    ...overrides,
  }
}

describe('signOutWarning', () => {
  it('says nothing when everything reached the server', () => {
    expect(signOutWarning({ queuedChanges: 0, customListsUnsynced: false })).toBeNull()
  })

  it('warns that unsynced custom lists are deleted', () => {
    const text = signOutWarning({ queuedChanges: 0, customListsUnsynced: true })
    expect(text).toContain('custom lists')
    expect(text).toContain('deletes them')
    expect(text).toContain('Sign out anyway?')
  })

  it('says queued task changes are kept for this account, with the right number', () => {
    const single = signOutWarning({ queuedChanges: 1, customListsUnsynced: false })
    expect(single).toContain('1 task change is still waiting')
    expect(single).toContain('It stays on this device and is sent')
    const text = signOutWarning({ queuedChanges: 3, customListsUnsynced: false })
    expect(text).toContain('3 task changes are still waiting')
    expect(text).toContain('They stay on this device and are sent')
    expect(text).toContain('sign in to this account')
  })
})

describe('checkUnsyncedWork', () => {
  it('tries to send first, then reports what is left', async () => {
    const d = deps({
      snapshot: vi.fn(async () => ({ success: true as const, data: snapshot(2) })),
      getConfig: vi.fn(async () => config({}, true)),
    })
    await expect(checkUnsyncedWork(d)).resolves.toEqual({ queuedChanges: 2, customListsUnsynced: true })
    expect(d.syncCustomLists).toHaveBeenCalledOnce()
    expect(d.replayNow).toHaveBeenCalledOnce()
  })

  it('does not wait forever on a server that does not answer', async () => {
    const d = deps({
      syncCustomLists: vi.fn(() => new Promise<never>(() => {})),
      replayNow: vi.fn(() => new Promise<never>(() => {})),
    })
    await expect(checkUnsyncedWork(d)).resolves.toEqual({ queuedChanges: 0, customListsUnsynced: false })
  })

  it('ignores a failed send and a queue it cannot read', async () => {
    const d = deps({
      syncCustomLists: vi.fn(async () => { throw new Error('offline') }),
      snapshot: vi.fn(async () => ({ success: false as const, error: 'no queue' })),
    })
    await expect(checkUnsyncedWork(d)).resolves.toEqual({ queuedChanges: 0, customListsUnsynced: false })
  })

  it('does not count standalone lists, which stay on this device', async () => {
    const d = deps({ getConfig: vi.fn(async () => config({ standalone_mode: true }, true)) })
    expect((await checkUnsyncedWork(d)).customListsUnsynced).toBe(false)
  })
})
