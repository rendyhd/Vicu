import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { backupPathFor } from '../atomic-file'

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
}))

async function load() {
  vi.resetModules()
  const cache = await import('../cache')
  const service = await import('../offline/service')
  return { cache, queue: () => service.getOfflineQueue(), service }
}

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('task cache and standalone store (split from the queue, D-SYNC-5)', () => {
  let warn: ReturnType<typeof vi.spyOn>
  const file = (name: string) => join(state.dir, name)

  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-cache-store-'))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('splits a legacy combined offline-cache.json on first use, without losing queue, standalone tasks or cache', async () => {
    writeFileSync(
      file('offline-cache.json'),
      JSON.stringify({
        pendingActions: [{ id: 'a1', type: 'complete', createdAt: '2026-10-01T10:00:00Z', taskId: 5, taskData: { id: 5, title: 'Pay rent' } }],
        cachedTasks: [{ id: 5, title: 'Pay rent', done: false }, { id: 6, title: 'Other', done: false }],
        cachedTasksTimestamp: '2026-10-01T09:00:00Z',
        standaloneTasks: [{ id: 'local_1', title: 'Local', description: '', due_date: NULL_DATE, priority: 0, done: false, created: 'c', updated: 'u' }],
      })
    )

    const { cache, queue } = await load()

    expect(cache.getAllStandaloneTasks().map((t) => t.title)).toEqual(['Local'])
    expect(queue().getPending()).toMatchObject([{ id: 'a1', type: 'update', taskId: 5, patch: { done: true } }])
    // the cache overlays the migrated queue: the task completed offline is hidden
    expect((cache.getCachedTasks().tasks as Array<{ id: number }>).map((t) => t.id)).toEqual([6])
    expect(JSON.parse(readFileSync(file('offline-cache.json'), 'utf-8'))).not.toHaveProperty('pendingActions')
    expect(existsSync(file('offline-queue.json'))).toBe(true)
    expect(existsSync(file('standalone-tasks.json'))).toBe(true)
  })

  it('writes the task cache compactly and asynchronously, and flushes on demand', async () => {
    const { cache } = await load()
    cache.setCachedTasks([{ id: 1, title: 'A' }])
    expect(cache.taskCacheHasUnsavedChanges()).toBe(true)

    await cache.flushTaskCache()

    expect(cache.taskCacheHasUnsavedChanges()).toBe(false)
    const raw = readFileSync(file('offline-cache.json'), 'utf-8')
    expect(raw).not.toContain('\n')
    expect(JSON.parse(raw)).toEqual({ cachedTasks: [{ id: 1, title: 'A' }], cachedTasksTimestamp: expect.any(String) })
  })

  it('keeps the last of several rapid cache writes and serves it from memory', async () => {
    const { cache } = await load()
    for (let i = 0; i < 20; i++) cache.setCachedTasks([{ id: i, title: `t${i}` }])
    // served from memory immediately, before any write finished
    expect((cache.getCachedTasks().tasks as Array<{ id: number }>)[0].id).toBe(19)
    await cache.flushTaskCache()
    expect(JSON.parse(readFileSync(file('offline-cache.json'), 'utf-8')).cachedTasks[0].id).toBe(19)
  })

  it('serves a cache that was saved by a previous run', async () => {
    writeFileSync(file('offline-cache.json'), JSON.stringify({ cachedTasks: [{ id: 9, title: 'old' }], cachedTasksTimestamp: '2026-10-01T00:00:00Z' }))
    const { cache } = await load()
    expect(cache.getCachedTasks()).toEqual({ tasks: [{ id: 9, title: 'old' }], timestamp: '2026-10-01T00:00:00Z' })
  })

  it('treats an unreadable task cache as empty instead of throwing', async () => {
    writeFileSync(file('offline-cache.json'), '{"cachedTasks": [ {')
    const { cache } = await load()
    expect(cache.getCachedTasks()).toEqual({ tasks: null, timestamp: null })
  })

  it('shows tasks created offline in the cached list, as pending rows', async () => {
    const { cache, queue } = await load()
    cache.setCachedTasks([{ id: 1, title: 'A', done: false }])
    const created = await queue().enqueueCreate({ projectId: 7, fields: { title: 'Offline task', priority: 2 } })

    const rows = cache.getCachedTasks().tasks as Array<{ id: unknown; title: string; priority: number }>
    expect(rows.map((r) => r.id)).toEqual([1, created.pendingId])
    expect(rows[1]).toMatchObject({ title: 'Offline task', priority: 2 })
  })

  it('recovers standalone tasks from the backup when their file is damaged', async () => {
    const first = await load()
    first.cache.addStandaloneTask('One', null, null)
    first.cache.addStandaloneTask('Two', null, null) // the second write leaves the first version as .bak
    expect(existsSync(backupPathFor(file('standalone-tasks.json')))).toBe(true)
    writeFileSync(file('standalone-tasks.json'), '{"standaloneTasks": [')

    const second = await load()

    expect(second.cache.getAllStandaloneTasks().map((t) => t.title)).toEqual(['One'])
  })

  it('writes standalone tasks before the call returns (they are the only copy)', async () => {
    const { cache } = await load()
    const task = cache.addStandaloneTask('Mine', 'notes', null)
    const stored = JSON.parse(readFileSync(file('standalone-tasks.json'), 'utf-8'))
    expect(stored.standaloneTasks.map((t: { id: string }) => t.id)).toEqual([task.id])
  })
})
