import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../api-result'
import { countCarriersByProject, createProjectCounts, PROJECT_COUNT_TTL_MS } from '../project-task-counts'

function setup(options: { totals?: Record<string, number>; carriers?: ApiResult<ReadonlyMap<number, number>>; server?: string | null } = {}) {
  let clock = 1_000_000
  const fetchTotal = vi.fn(async (projectId: number, done: boolean): Promise<ApiResult<number>> => {
    const total = options.totals?.[`${projectId}:${done}`]
    return total === undefined ? { success: false, error: 'no total' } : { success: true, data: total }
  })
  const carrierCounts = vi.fn(async () => options.carriers ?? ({ success: true, data: new Map<number, number>() } as ApiResult<ReadonlyMap<number, number>>))
  const server = { current: options.server === undefined ? 'https://v.example' : options.server }
  const counts = createProjectCounts({ fetchTotal, carrierCounts, server: () => server.current, now: () => clock })
  return { counts, fetchTotal, carrierCounts, server, advance: (ms: number) => { clock += ms } }
}

describe('project task counts', () => {
  it('subtracts the known hidden carriers from a done count', async () => {
    const { counts } = setup({ totals: { '5:true': 9 }, carriers: { success: true, data: new Map([[5, 2], [6, 1]]) } })
    expect(await counts.count(5, true)).toEqual({ success: true, data: 7 })
  })

  it('never goes below zero and does not touch an open count', async () => {
    const { counts, carrierCounts } = setup({ totals: { '5:true': 1, '5:false': 4 }, carriers: { success: true, data: new Map([[5, 3]]) } })
    expect(await counts.count(5, true)).toEqual({ success: true, data: 0 })
    carrierCounts.mockClear()
    expect(await counts.count(5, false)).toEqual({ success: true, data: 4 })
    expect(carrierCounts).not.toHaveBeenCalled()
  })

  it('caches for ten minutes and then asks again', async () => {
    const { counts, fetchTotal, advance } = setup({ totals: { '1:true': 3 } })
    await counts.count(1, true)
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(1)
    advance(PROJECT_COUNT_TTL_MS - 1)
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(1)
    advance(2)
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(2)
  })

  it('shares one request between overlapping questions and lists the carriers once for all projects', async () => {
    const { counts, fetchTotal, carrierCounts } = setup({ totals: { '1:true': 3, '2:true': 4, '3:true': 5 } })
    const answers = await Promise.all([counts.count(1, true), counts.count(1, true), counts.count(2, true), counts.count(3, true)])
    expect(answers.map((a) => a.success && a.data)).toEqual([3, 3, 4, 5])
    expect(fetchTotal).toHaveBeenCalledTimes(3)
    expect(carrierCounts).toHaveBeenCalledTimes(1)
  })

  it('invalidates one project, or all of them', async () => {
    const { counts, fetchTotal } = setup({ totals: { '1:true': 3, '2:true': 4 } })
    await counts.count(1, true)
    await counts.count(2, true)
    counts.invalidate(1)
    await counts.count(1, true)
    await counts.count(2, true)
    expect(fetchTotal).toHaveBeenCalledTimes(3)
    counts.invalidate()
    await counts.count(1, true)
    await counts.count(2, true)
    expect(fetchTotal).toHaveBeenCalledTimes(5)
  })

  it('does not cache an answer that was asked for before an invalidation', async () => {
    const { counts, fetchTotal } = setup({ totals: { '1:true': 3 } })
    let release: () => void = () => {}
    fetchTotal.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ success: true, data: 3 }) }))
    const pending = counts.count(1, true)
    counts.invalidate(1)
    release()
    await pending
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(2)
  })

  it('does not let a count asked after an invalidation join a request that started before it', async () => {
    const { counts, fetchTotal } = setup()
    let releaseOld: () => void = () => {}
    fetchTotal.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve({ success: true, data: 5 }) }))
    fetchTotal.mockImplementationOnce(async () => ({ success: true, data: 4 }))
    const before = counts.count(1, false)
    counts.invalidate(1)
    // The task was completed: the new question must get the new number, not the old request's answer.
    expect(await counts.count(1, false)).toEqual({ success: true, data: 4 })
    releaseOld()
    expect(await before).toEqual({ success: true, data: 5 })
    expect(fetchTotal).toHaveBeenCalledTimes(2)
    // The old request finishing later did not take the new request's place or poison the cache.
    expect(await counts.count(1, false)).toEqual({ success: true, data: 4 })
    expect(fetchTotal).toHaveBeenCalledTimes(2)
  })

  it('also separates requests after invalidating everything', async () => {
    const { counts, fetchTotal } = setup()
    let releaseOld: () => void = () => {}
    fetchTotal.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve({ success: true, data: 5 }) }))
    fetchTotal.mockImplementationOnce(async () => ({ success: true, data: 4 }))
    const before = counts.count(2, false)
    counts.invalidate()
    expect(await counts.count(2, false)).toEqual({ success: true, data: 4 })
    releaseOld()
    await before
    expect(await counts.count(2, false)).toEqual({ success: true, data: 4 })
  })

  it('does not let the carrier list asked for before a global invalidation join or replace a newer one', async () => {
    const { counts, carrierCounts } = setup({ totals: { '1:true': 5, '2:true': 7 } })
    const empty: ApiResult<ReadonlyMap<number, number>> = { success: true, data: new Map() }
    const withNew: ApiResult<ReadonlyMap<number, number>> = { success: true, data: new Map([[1, 1], [2, 1]]) }
    let releaseOld: () => void = () => {}
    carrierCounts.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = () => resolve(empty) }))
    carrierCounts.mockImplementationOnce(async () => withNew)

    const old = counts.count(1, true)
    // A carrier was created: everything is dropped, including the carrier list that is on its way.
    counts.invalidate()
    expect(await counts.count(1, true)).toEqual({ success: true, data: 4 })
    expect(carrierCounts).toHaveBeenCalledTimes(2)

    // The old list arrives last. It answers its own caller but is not kept for later questions.
    releaseOld()
    expect(await old).toEqual({ success: true, data: 5 })
    expect(await counts.count(2, true)).toEqual({ success: true, data: 6 })
    expect(carrierCounts).toHaveBeenCalledTimes(2)
    expect(await counts.count(1, true)).toEqual({ success: true, data: 4 })
  })

  it('does not cache failures, and shows a count with unknown carriers without caching it', async () => {
    const { counts, fetchTotal } = setup({ totals: {} })
    expect((await counts.count(1, true)).success).toBe(false)
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(2)

    const partial = setup({ totals: { '1:true': 5 }, carriers: { success: false, error: 'offline' } })
    expect(await partial.counts.count(1, true)).toEqual({ success: true, data: 5 })
    await partial.counts.count(1, true)
    expect(partial.fetchTotal).toHaveBeenCalledTimes(2)
  })

  it('answers with an error and no request when no server is configured', async () => {
    const { counts, fetchTotal } = setup({ totals: { '1:true': 3 }, server: null })
    expect((await counts.count(1, true)).success).toBe(false)
    expect(fetchTotal).not.toHaveBeenCalled()
  })

  it('keeps servers apart', async () => {
    const { counts, fetchTotal, server } = setup({ totals: { '1:true': 3 } })
    await counts.count(1, true)
    server.current = 'https://other.example'
    await counts.count(1, true)
    expect(fetchTotal).toHaveBeenCalledTimes(2)
  })
})

describe('countCarriersByProject', () => {
  it('counts per project and skips tasks without a usable project id', () => {
    const map = countCarriersByProject([{ project_id: 3 }, { project_id: 3 }, { project_id: 8 }, {}, { project_id: 0 }, { project_id: 1.5 }])
    expect([...map.entries()]).toEqual([[3, 2], [8, 1]])
  })
})
