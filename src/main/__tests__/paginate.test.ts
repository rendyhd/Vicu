import { describe, expect, it, vi } from 'vitest'
import type { ApiResult } from '../api-result'
import { collectAllPages, type PageEnvelope } from '../paginate'
import { MAX_PAGE_SIZE, createTaskCollectionSearchParams, withoutNestedSubtasks } from '../api-v2'

interface Item { id: number; related_tasks?: { parenttask?: Array<{ id: number; done?: boolean }> } }

const items = (from: number, to: number): Item[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i }))

/** A fake collection endpoint that mimics Vikunja: per_page <= 1000 or a 422. */
function fakeServer(all: Item[], opts: { omitTotalPages?: boolean } = {}) {
  const requests: Array<{ page: number; perPage: number }> = []
  const fetchPage = async (page: number, perPage: number): Promise<ApiResult<PageEnvelope<Item>>> => {
    requests.push({ page, perPage })
    if (perPage > 1000) return { success: false, error: 'expected number <= 1000', statusCode: 422 }
    const slice = all.slice((page - 1) * perPage, page * perPage)
    const envelope: PageEnvelope<Item> = {
      items: slice.length ? slice : null,
      page,
      per_page: perPage,
    }
    if (!opts.omitTotalPages) envelope.total_pages = Math.max(1, Math.ceil(all.length / perPage))
    return { success: true, data: envelope }
  }
  return { requests, fetchPage }
}

describe('collectAllPages', () => {
  it('returns three pages for 2,500 tasks and never asks for more than 1000 per page', async () => {
    const server = fakeServer(items(1, 2500))
    const perPage = Number(createTaskCollectionSearchParams({ per_page: 10000 }).get('per_page'))

    const result = await collectAllPages((page) => server.fetchPage(page, perPage), { pageSize: perPage })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toHaveLength(2500)
    expect(server.requests).toEqual([
      { page: 1, perPage: 1000 },
      { page: 2, perPage: 1000 },
      { page: 3, perPage: 1000 },
    ])
  })

  it('does not stop when a page shrinks after nested subtasks are removed', async () => {
    // Page 1 carries 10 subtasks whose parents are on the same page, so the
    // per-page filter used to leave 40 of 50 items and end pagination early.
    const page1: Item[] = [
      ...items(1, 40),
      ...items(41, 50).map((c, i) => ({ ...c, related_tasks: { parenttask: [{ id: i + 1 }] } })),
    ]
    const all = [...page1, ...items(51, 120)]
    const server = fakeServer(all)

    const result = await collectAllPages((page) => server.fetchPage(page, 50), { pageSize: 50 })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(server.requests.map((r) => r.page)).toEqual([1, 2, 3])
    expect(result.data).toHaveLength(120)
    expect(withoutNestedSubtasks(page1)).toHaveLength(40)
    expect(withoutNestedSubtasks(result.data)).toHaveLength(110)
  })

  it('stops on an empty page even when total_pages is missing', async () => {
    const server = fakeServer(items(1, 100), { omitTotalPages: true })

    const result = await collectAllPages((page) => server.fetchPage(page, 50), { pageSize: 50 })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toHaveLength(100)
    expect(server.requests.map((r) => r.page)).toEqual([1, 2, 3])
  })

  it('stops after a short page when total_pages is missing', async () => {
    const server = fakeServer(items(1, 70), { omitTotalPages: true })

    const result = await collectAllPages((page) => server.fetchPage(page, 50), { pageSize: 50 })

    expect(result.success).toBe(true)
    expect(server.requests.map((r) => r.page)).toEqual([1, 2])
  })

  it('honors total_pages and does not request a page beyond it', async () => {
    const fetchPage = vi.fn(async (page: number): Promise<ApiResult<PageEnvelope<Item>>> => ({
      success: true,
      data: { items: items(page * 10, page * 10 + 9), total_pages: 2, per_page: 10 },
    }))

    const result = await collectAllPages(fetchPage, { pageSize: 10 })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.success && result.data).toHaveLength(20)
  })

  it('trusts the server per_page when it clamps the requested page size', async () => {
    // The caller asked for 1000 but the server answered 50 per page.
    const server = fakeServer(items(1, 120), { omitTotalPages: true })

    const result = await collectAllPages((page) => server.fetchPage(page, 50), { pageSize: 1000 })

    expect(result.success && result.data).toHaveLength(120)
    expect(server.requests.map((r) => r.page)).toEqual([1, 2, 3])
  })

  it('stops when a page adds nothing new (server ignoring the page parameter)', async () => {
    const fetchPage = vi.fn(async (): Promise<ApiResult<PageEnvelope<Item>>> => ({
      success: true,
      data: { items: items(1, 50), per_page: 50 },
    }))

    const result = await collectAllPages(fetchPage, { pageSize: 50 })

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.success && result.data).toHaveLength(50)
  })

  it('dedupes rows that shift across a page boundary', async () => {
    const pages = [items(1, 3), items(3, 5)]
    const result = await collectAllPages(async (page): Promise<ApiResult<PageEnvelope<Item>>> => ({
      success: true,
      data: { items: pages[page - 1] ?? [], total_pages: 2, per_page: 3 },
    }), { pageSize: 3 })

    expect(result.success && result.data.map((i) => i.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('returns the error of a failing page', async () => {
    const result = await collectAllPages(async (page): Promise<ApiResult<PageEnvelope<Item>>> =>
      page === 1
        ? { success: true, data: { items: items(1, 50), total_pages: 3, per_page: 50 } }
        : { success: false, error: 'Server error', statusCode: 500 },
    { pageSize: 50 })

    expect(result).toEqual({ success: false, error: 'Server error', statusCode: 500 })
  })

  it('surfaces an error instead of silently truncating at the safety cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await collectAllPages(async (page): Promise<ApiResult<PageEnvelope<Item>>> => ({
      success: true,
      data: { items: items(page * 10, page * 10 + 9), total_pages: 1000, per_page: 10 },
    }), { pageSize: 10, maxPages: 3 })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/3 pages/)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('createTaskCollectionSearchParams page size', () => {
  it('clamps per_page to the server maximum', () => {
    expect(createTaskCollectionSearchParams({ per_page: 10000 }).get('per_page')).toBe(String(MAX_PAGE_SIZE))
    expect(createTaskCollectionSearchParams({ per_page: 1001 }).get('per_page')).toBe('1000')
    expect(createTaskCollectionSearchParams({ per_page: 200 }).get('per_page')).toBe('200')
  })

  it('ignores per_page values the server would reject', () => {
    expect(createTaskCollectionSearchParams({ per_page: 0 }).has('per_page')).toBe(false)
    expect(createTaskCollectionSearchParams({ per_page: -5 }).has('per_page')).toBe(false)
    expect(createTaskCollectionSearchParams({ per_page: 'abc' }).has('per_page')).toBe(false)
  })
})
