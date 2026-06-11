import { describe, it, expect } from 'vitest'
import { fetchAllPages } from '../fetch-all-pages'

interface Item { id: number }
const page = (ids: number[]): Item[] => ids.map((id) => ({ id }))

describe('fetchAllPages', () => {
  it('fetches pages until a short page is returned', async () => {
    const pages = [page([1, 2, 3]), page([4, 5, 6]), page([7])]
    const calls: number[] = []
    const result = await fetchAllPages(async (p) => {
      calls.push(p)
      return pages[p - 1] ?? []
    }, { pageSize: 3 })
    expect(calls).toEqual([1, 2, 3])
    expect(result.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('stops after a single short page', async () => {
    const calls: number[] = []
    const result = await fetchAllPages(async (p) => { calls.push(p); return page([1, 2]) }, { pageSize: 3 })
    expect(calls).toEqual([1])
    expect(result).toHaveLength(2)
  })

  it('dedupes items that shift across page boundaries', async () => {
    const pages = [page([1, 2, 3]), page([3, 4])]
    const result = await fetchAllPages(async (p) => pages[p - 1] ?? [], { pageSize: 3 })
    expect(result.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('respects maxPages as a hard stop', async () => {
    const calls: number[] = []
    await fetchAllPages(async (p) => { calls.push(p); return page([p * 10, p * 10 + 1, p * 10 + 2]) }, { pageSize: 3, maxPages: 2 })
    expect(calls).toEqual([1, 2])
  })
})
