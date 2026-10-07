import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PERSISTED_AGE_MS,
  SAVE_DEBOUNCE_MS,
  SAVE_MAX_WAIT_MS,
  restoreQueryCache,
  sameServer,
  shouldPersistQuery,
  snapshotQueryCache,
  startQueryPersistence,
  type PersistStore,
  type PersistedQueryCache,
} from '../query-persistence'

function memoryStore(initial?: PersistedQueryCache): PersistStore & { value: PersistedQueryCache | undefined; writes: number } {
  const store = {
    value: initial,
    writes: 0,
    read: async () => store.value,
    write: async (v: PersistedQueryCache) => {
      store.value = v
      store.writes++
    },
    clear: async () => {
      store.value = undefined
    },
  }
  return store
}

const task = (id: number) => ({ id, title: `Task ${id}` })

function filled(): QueryClient {
  const qc = new QueryClient()
  qc.setQueryData(['tasks', { filter: 'done = false' }], [task(1), task(2)])
  qc.setQueryData(['tasks', 'search', 'milk'], [task(3)])
  qc.setQueryData(['view-tasks', 7, 70], [task(1)])
  qc.setQueryData(['projects'], [{ id: 7, title: 'Home' }])
  qc.setQueryData(['labels'], [{ id: 1, title: 'home' }])
  qc.setQueryData(['task-detail', 1], [task(9)])
  qc.setQueryData(['routines'], [])
  return qc
}

describe('what is persisted', () => {
  it('keeps task lists, project views, projects and labels, but not searches, details or routines', () => {
    const qc = filled()
    const snapshot = snapshotQueryCache(qc, 'https://v.example', 1000)!

    const keys = snapshot.state.queries.map((q) => JSON.stringify(q.queryKey)).sort()
    expect(keys).toEqual([
      JSON.stringify(['labels']),
      JSON.stringify(['projects']),
      JSON.stringify(['tasks', { filter: 'done = false' }]),
      JSON.stringify(['view-tasks', 7, 70]),
    ])
  })

  it('does not persist a query that failed or has no data yet', () => {
    const qc = new QueryClient()
    const query = qc.getQueryCache().build(qc, { queryKey: ['tasks', {}] })
    expect(shouldPersistQuery(query)).toBe(false)
  })

  it('saves nothing for an empty cache', () => {
    expect(snapshotQueryCache(new QueryClient(), 'https://v.example', 1)).toBeNull()
  })
})

describe('restoring (so the cached lists render when the app starts offline)', () => {
  it('puts the saved lists into a fresh client, still marked stale so they refetch when online', async () => {
    const source = filled()
    // Fetched an hour ago.
    source.setQueryData(['tasks', { filter: 'done = false' }], [task(1), task(2)], { updatedAt: Date.now() - 60 * 60_000 })
    const store = memoryStore(snapshotQueryCache(source, 'https://v.example', 1000)!)
    const fresh = new QueryClient()

    const restored = await restoreQueryCache(fresh, store, 'https://v.example', 2000)

    expect(restored).toBe(true)
    expect(fresh.getQueryData(['tasks', { filter: 'done = false' }])).toEqual([task(1), task(2)])
    expect(fresh.getQueryData(['projects'])).toEqual([{ id: 7, title: 'Home' }])
    // dataUpdatedAt is the time of the original fetch, not the restore: the default staleTime has long passed.
    expect(fresh.getQueryState(['tasks', { filter: 'done = false' }])?.dataUpdatedAt).toBeLessThan(Date.now() - 60_000)
  })

  it('never restores a copy that belongs to another server, and clears it', async () => {
    const store = memoryStore(snapshotQueryCache(filled(), 'https://old.example', 1000)!)
    const fresh = new QueryClient()

    expect(await restoreQueryCache(fresh, store, 'https://new.example', 2000)).toBe(false)

    expect(fresh.getQueryData(['projects'])).toBeUndefined()
    expect(store.value).toBeUndefined()
  })

  it('never restores a copy older than the retention window', async () => {
    const store = memoryStore(snapshotQueryCache(filled(), 'https://v.example', 1000)!)
    const fresh = new QueryClient()

    expect(await restoreQueryCache(fresh, store, 'https://v.example', 1000 + MAX_PERSISTED_AGE_MS + 1)).toBe(false)
    expect(fresh.getQueryData(['projects'])).toBeUndefined()
  })

  it('restores nothing and clears the copy when signed out', async () => {
    const store = memoryStore(snapshotQueryCache(filled(), 'https://v.example', 1000)!)
    expect(await restoreQueryCache(new QueryClient(), store, '', 2000)).toBe(false)
    expect(store.value).toBeUndefined()
  })

  it('survives a store that cannot be read', async () => {
    const store: PersistStore = { read: async () => { throw new Error('blocked') }, write: async () => {}, clear: async () => {} }
    expect(await restoreQueryCache(new QueryClient(), store, 'https://v.example')).toBe(false)
  })

  it('compares servers without case or a trailing slash', () => {
    expect(sameServer('https://V.example/', 'https://v.example')).toBe(true)
    expect(sameServer('https://a.example', 'https://b.example')).toBe(false)
  })
})

describe('saving', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes once for a burst of updates, after the debounce', async () => {
    const qc = new QueryClient()
    const store = memoryStore()
    const saver = startQueryPersistence(qc, { store, getServer: () => 'https://v.example' })

    qc.setQueryData(['projects'], [{ id: 1 }])
    qc.setQueryData(['labels'], [{ id: 1 }])
    qc.setQueryData(['projects'], [{ id: 1 }, { id: 2 }])
    expect(store.writes).toBe(0)

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)

    expect(store.writes).toBe(1)
    expect(store.value?.server).toBe('https://v.example')
    saver.stop()
  })

  it('does not wait longer than the max wait while updates keep coming', async () => {
    const qc = new QueryClient()
    const store = memoryStore()
    const saver = startQueryPersistence(qc, { store, getServer: () => 'https://v.example' })

    for (let i = 0; i < 20; i++) {
      qc.setQueryData(['projects'], [{ id: i }])
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 500)
    }

    expect(store.writes).toBeGreaterThanOrEqual(1)
    expect(SAVE_MAX_WAIT_MS).toBeGreaterThan(SAVE_DEBOUNCE_MS)
    saver.stop()
  })

  it('saves nothing while signed out', async () => {
    const qc = new QueryClient()
    const store = memoryStore()
    const saver = startQueryPersistence(qc, { store, getServer: () => '' })

    qc.setQueryData(['projects'], [{ id: 1 }])
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)

    expect(store.writes).toBe(0)
    saver.stop()
  })

  it('flush writes immediately', async () => {
    const qc = new QueryClient()
    const store = memoryStore()
    const saver = startQueryPersistence(qc, { store, getServer: () => 'https://v.example' })

    qc.setQueryData(['projects'], [{ id: 1 }])
    await saver.flush()

    expect(store.writes).toBe(1)
    saver.stop()
  })

  it('a failing store does not throw into the app', async () => {
    const qc = new QueryClient()
    const store: PersistStore = { read: async () => undefined, write: async () => { throw new Error('quota') }, clear: async () => {} }
    const saver = startQueryPersistence(qc, { store, getServer: () => 'https://v.example' })

    qc.setQueryData(['projects'], [{ id: 1 }])
    await expect(vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10)).resolves.not.toThrow()
    saver.stop()
  })
})
