import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../api-result'
import { mapLimited } from '../map-limited'
import { createTtlCache } from '../ttl-cache'
import { ACTIVE_PROJECTS_TTL_MS, createActiveProjectIds } from '../quick-entry/active-projects'
import { fetchPositionSortedTasks } from '../quick-entry/position-sort'

const ok = <T,>(data: T): ApiResult<T> => ({ success: true, data })

describe('mapLimited', () => {
  it('keeps at most `limit` calls in flight and returns results in input order', async () => {
    let inFlight = 0
    let peak = 0
    const finishOrder: number[] = []
    const result = await mapLimited([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      // Later items finish first.
      await new Promise((resolve) => setTimeout(resolve, 20 - n * 2))
      inFlight -= 1
      finishOrder.push(n)
      return n * 10
    })
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
    expect(peak).toBe(3)
    expect(finishOrder).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('handles no items and a limit larger than the list', async () => {
    expect(await mapLimited([], 4, async (n: number) => n)).toEqual([])
    expect(await mapLimited([1, 2], 10, async (n) => n + 1)).toEqual([2, 3])
  })
})

describe('createTtlCache', () => {
  it('forgets an entry once its time is up', () => {
    let now = 1_000
    const cache = createTtlCache<number, string>(100, () => now)
    cache.set(1, 'a')
    now += 99
    expect(cache.get(1)).toBe('a')
    now += 1
    expect(cache.get(1)).toBeUndefined()
  })

  it('deletes and clears', () => {
    const cache = createTtlCache<number, string>(100, () => 0)
    cache.set(1, 'a')
    cache.set(2, 'b')
    cache.delete(1)
    expect(cache.get(1)).toBeUndefined()
    expect(cache.get(2)).toBe('b')
    cache.clear()
    expect(cache.get(2)).toBeUndefined()
  })
})

describe('Quick View position sort reads (D-IPC-6)', () => {
  const params = { sort_by: 'position' }

  function api(overrides: { views?: (projectId: number) => ApiResult<unknown[]>; tasks?: (projectId: number, viewId: number) => ApiResult<unknown[]> } = {}) {
    const state = { inFlight: 0, peak: 0, views: [] as number[], tasks: [] as Array<[number, number]> }
    const track = async <T,>(fn: () => T): Promise<T> => {
      state.inFlight += 1
      state.peak = Math.max(state.peak, state.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      state.inFlight -= 1
      return fn()
    }
    return {
      state,
      deps: {
        fetchViews: (projectId: number) => track(() => {
          state.views.push(projectId)
          return overrides.views ? overrides.views(projectId) : ok([{ id: projectId * 10, view_kind: 'list' }])
        }),
        fetchViewTasks: (projectId: number, viewId: number) => track(() => {
          state.tasks.push([projectId, viewId])
          return overrides.tasks ? overrides.tasks(projectId, viewId) : ok([{ id: projectId * 100 }])
        }),
      },
    }
  }

  it('reads the projects a few at a time instead of one after the other, and keeps the project order', async () => {
    const { deps, state } = api()
    const ids = [1, 2, 3, 4, 5, 6, 7, 8]

    const result = await fetchPositionSortedTasks(ids, params, deps, { concurrency: 4 })

    expect(result).toEqual({ success: true, data: ids.map((id) => ({ id: id * 100 })) })
    expect(state.peak).toBeGreaterThan(1)
    expect(state.peak).toBeLessThanOrEqual(4)
  })

  it('remembers each project list view, so the next refresh skips the views requests', async () => {
    const viewCache = createTtlCache<number, number>(60_000)
    const first = api()
    await fetchPositionSortedTasks([1, 2, 3], params, first.deps, { viewCache })
    expect(first.state.views.sort()).toEqual([1, 2, 3])

    const second = api()
    const result = await fetchPositionSortedTasks([1, 2, 3], params, second.deps, { viewCache })
    expect(second.state.views).toEqual([])
    expect(second.state.tasks.sort()).toEqual([[1, 10], [2, 20], [3, 30]])
    expect(result).toEqual({ success: true, data: [{ id: 100 }, { id: 200 }, { id: 300 }] })
  })

  it('reads the views again once the remembered ones have expired', async () => {
    let now = 0
    const viewCache = createTtlCache<number, number>(1_000, () => now)
    await fetchPositionSortedTasks([1], params, api().deps, { viewCache })
    now = 1_000
    const again = api()
    await fetchPositionSortedTasks([1], params, again.deps, { viewCache })
    expect(again.state.views).toEqual([1])
  })

  it('looks a remembered view up again, once, when it no longer works', async () => {
    const viewCache = createTtlCache<number, number>(60_000)
    viewCache.set(1, 10)
    const { deps, state } = api({
      views: () => ok([{ id: 99, view_kind: 'list' }]),
      tasks: (_projectId, viewId) => (viewId === 10 ? { success: false, error: 'Not found', statusCode: 404 } : ok([{ id: 7 }])),
    })

    const result = await fetchPositionSortedTasks([1], params, deps, { viewCache })

    expect(result).toEqual({ success: true, data: [{ id: 7 }] })
    expect(state.views).toEqual([1])
    expect(state.tasks).toEqual([[1, 10], [1, 99]])
    expect(viewCache.get(1)).toBe(99)
  })

  it('does not retry a view it just read', async () => {
    const { deps, state } = api({ tasks: () => ({ success: false, error: 'Server error', statusCode: 500 }) })
    const result = await fetchPositionSortedTasks([1], params, deps, { viewCache: createTtlCache(60_000) })
    expect(result).toMatchObject({ success: false, error: 'Server error' })
    expect(state.tasks).toHaveLength(1)
  })

  it('fails with the first failure in project order and starts nothing new after one', async () => {
    const { deps, state } = api({
      tasks: (projectId) => (projectId === 2 ? { success: false, error: 'Server error', statusCode: 500 } : ok([{ id: projectId }])),
    })

    const result = await fetchPositionSortedTasks([1, 2, 3, 4, 5], params, deps, { concurrency: 1 })

    expect(result).toEqual({ success: false, error: 'Server error', statusCode: 500 })
    expect(state.tasks.map(([projectId]) => projectId)).toEqual([1, 2])
  })

  it('works without a cache, as before', async () => {
    const { deps } = api()
    expect(await fetchPositionSortedTasks([1, 2], params, deps)).toEqual({ success: true, data: [{ id: 100 }, { id: 200 }] })
  })
})

describe('active project ids for Quick View (D-IPC-6)', () => {
  function setup(result: () => ApiResult<unknown[]> = () => ok([{ id: 1 }, { id: 2 }, { title: 'no id' }])) {
    let now = 1_000
    const fetchProjects = vi.fn(async () => result())
    const projects = createActiveProjectIds({ fetchProjects, now: () => now })
    return { projects, fetchProjects, advance: (ms: number) => { now += ms } }
  }

  it('reads the project list once for a burst of refreshes', async () => {
    const { projects, fetchProjects, advance } = setup()
    expect([...(await projects.get('https://a'))!]).toEqual([1, 2])
    advance(10_000)
    await projects.get('https://a')
    await projects.get('https://a')
    expect(fetchProjects).toHaveBeenCalledTimes(1)

    advance(ACTIVE_PROJECTS_TTL_MS)
    await projects.get('https://a')
    expect(fetchProjects).toHaveBeenCalledTimes(2)
  })

  it('shares one read between requests that overlap', async () => {
    const { projects, fetchProjects } = setup()
    const [a, b] = await Promise.all([projects.get('https://a'), projects.get('https://a')])
    expect(a).toBe(b)
    expect(fetchProjects).toHaveBeenCalledTimes(1)
  })

  it('reads again for another account and after an invalidation', async () => {
    const { projects, fetchProjects } = setup()
    await projects.get('https://a')
    await projects.get('https://b')
    expect(fetchProjects).toHaveBeenCalledTimes(2)

    projects.invalidate()
    await projects.get('https://b')
    expect(fetchProjects).toHaveBeenCalledTimes(3)
  })

  it('does not remember a failure: the caller gets null and the next call tries again', async () => {
    let failing = true
    const { projects, fetchProjects } = setup(() => (failing ? { success: false, error: 'offline' } : ok([{ id: 3 }])))
    expect(await projects.get('https://a')).toBeNull()
    failing = false
    expect([...(await projects.get('https://a'))!]).toEqual([3])
    expect(fetchProjects).toHaveBeenCalledTimes(2)
  })

  it('does not keep an answer that was overtaken by a change while it was being read', async () => {
    let release: (value: ApiResult<unknown[]>) => void = () => {}
    const fetchProjects = vi.fn(() => new Promise<ApiResult<unknown[]>>((resolve) => { release = resolve }))
    const projects = createActiveProjectIds({ fetchProjects, now: () => 0 })

    const first = projects.get('https://a')
    projects.invalidate() // a project was just created or archived
    release(ok([{ id: 1 }]))
    expect([...(await first)!]).toEqual([1])

    // The answer was handed to its caller but not remembered, so the next call asks again.
    fetchProjects.mockImplementationOnce(async () => ok([{ id: 1 }, { id: 9 }]))
    expect([...(await projects.get('https://a'))!]).toEqual([1, 9])
  })
})
