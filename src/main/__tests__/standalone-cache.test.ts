import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
}))

async function loadCache() {
  vi.resetModules()
  return await import('../cache')
}

describe('standalone task store', () => {
  beforeEach(() => {
    state.dir = mkdtempSync(join(tmpdir(), 'vicu-standalone-'))
  })

  afterEach(() => {
    rmSync(state.dir, { recursive: true, force: true })
  })

  it('removes just the given task and persists it', async () => {
    const cache = await loadCache()
    const a = cache.addStandaloneTask('A', null, null)
    const b = cache.addStandaloneTask('B', 'notes', null)
    const c = cache.addStandaloneTask('C', null, null)

    cache.removeStandaloneTask(b.id)

    const reloaded = await loadCache()
    expect(reloaded.getAllStandaloneTasks().map((t) => t.id)).toEqual([a.id, c.id])
    expect(existsSync(join(state.dir, 'offline-cache.json.tmp'))).toBe(false)
  })

  it('ignores an unknown id', async () => {
    const cache = await loadCache()
    cache.addStandaloneTask('A', null, null)

    cache.removeStandaloneTask('local_missing')

    expect(cache.getAllStandaloneTasks()).toHaveLength(1)
  })

  it('keeps completed tasks (never uploaded) until the final sweep', async () => {
    const cache = await loadCache()
    const done = cache.addStandaloneTask('Done already', null, null)
    const open = cache.addStandaloneTask('Open', null, null)
    cache.markStandaloneTaskDone(done.id)
    const stored = () =>
      JSON.parse(readFileSync(join(state.dir, 'offline-cache.json'), 'utf-8')).standaloneTasks.map(
        (t: { id: string }) => t.id
      )

    // Only open tasks are uploaded; removing one leaves the completed one in the store.
    expect(cache.getAllStandaloneTasks().map((t) => t.id)).toEqual([open.id])
    cache.removeStandaloneTask(open.id)
    expect(stored()).toEqual([done.id])

    cache.clearStandaloneTasks()
    expect(stored()).toEqual([])
  })
})
