import { describe, expect, it, vi } from 'vitest'
import type { ViewerFilter } from '../config'
import type { ApiResult } from '../api-result'
import { MAX_PAGE_SIZE, createTaskCollectionSearchParams } from '../api-v2'
import { collectAllPages, type PageEnvelope } from '../paginate'
import { buildViewerFilterParams } from '../quick-entry/filter-builder'
import { fetchPositionSortedTasks } from '../quick-entry/position-sort'
import { cachedFallback } from '../quick-entry/fetch-fallback'

const baseFilter: ViewerFilter = {
  project_ids: [],
  sort_by: 'due_date',
  order_by: 'asc',
  due_date_filter: 'all',
}

const filters: Array<[string, ViewerFilter]> = [
  ['today view', { ...baseFilter, view_type: 'today' }],
  ['upcoming view', { ...baseFilter, view_type: 'upcoming' }],
  ['anytime view', { ...baseFilter, view_type: 'anytime' }],
  ['plain filter', baseFilter],
  ['project filter', { ...baseFilter, project_ids: [3, 4], due_date_filter: 'overdue' }],
  ['union with today', { ...baseFilter, project_ids: [3], include_today_all_projects: true }],
  ['this week', { ...baseFilter, due_date_filter: 'this_week', sort_by: 'priority' }],
]

describe('buildViewerFilterParams', () => {
  it.each(filters)('%s asks for at most 1000 items per page and lets the API client paginate', (_name, filter) => {
    const params = buildViewerFilterParams(filter) as unknown as Record<string, unknown>
    const query = createTaskCollectionSearchParams(params)

    expect(Number(query.get('per_page'))).toBeLessThanOrEqual(1000)
    expect(Number(query.get('per_page'))).toBeGreaterThan(0)
    // A fixed `page` would restrict the fetch to one page; without it every page is read.
    expect('page' in params).toBe(false)
    expect(query.has('page')).toBe(false)
  })
})

describe('Quick View list fetch', () => {
  it('returns 2,500 tasks in three requests, none above the server page limit', async () => {
    const total = 2500
    const requests: Array<{ page: number; perPage: number }> = []

    for (const [, filter] of filters) {
      requests.length = 0
      const params = buildViewerFilterParams(filter) as unknown as Record<string, unknown>
      const query = createTaskCollectionSearchParams(params)
      const perPage = Number(query.get('per_page'))

      const result = await collectAllPages(async (page): Promise<ApiResult<PageEnvelope<{ id: number }>>> => {
        requests.push({ page, perPage })
        // Vikunja 2.4: per_page above 1000 is a 422.
        if (perPage > 1000) return { success: false, error: 'expected number <= 1000', statusCode: 422 }
        const start = (page - 1) * perPage
        const ids = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => ({ id: start + i + 1 }))
        return { success: true, data: { items: ids, page, per_page: perPage, total_pages: Math.ceil(total / perPage) } }
      }, { pageSize: perPage })

      expect(result.success).toBe(true)
      if (result.success) expect(result.data).toHaveLength(total)
      expect(requests).toHaveLength(3)
      expect(Math.max(...requests.map((r) => r.perPage))).toBeLessThanOrEqual(MAX_PAGE_SIZE)
    }
  })
})

describe('fetchPositionSortedTasks', () => {
  const params = buildViewerFilterParams({ ...baseFilter, project_ids: [3, 4], sort_by: 'position' }) as unknown as Record<string, unknown>

  it('fetches the list view of each project without a page so every page is read', async () => {
    const fetchViews = vi.fn(async (projectId: number): Promise<ApiResult<unknown[]>> => ({
      success: true,
      data: [
        { id: projectId * 10 + 1, view_kind: 'kanban' },
        { id: projectId * 10 + 2, view_kind: 'list' },
      ],
    }))
    const fetchViewTasks = vi.fn(async (
      projectId: number,
      _viewId: number,
      _params: Record<string, unknown>,
    ): Promise<ApiResult<unknown[]>> => ({
      success: true,
      data: [{ id: projectId * 100 }],
    }))

    const result = await fetchPositionSortedTasks([3, 4], params, { fetchViews, fetchViewTasks })

    expect(result).toEqual({ success: true, data: [{ id: 300 }, { id: 400 }] })
    expect(fetchViewTasks.mock.calls.map((call) => [call[0], call[1]])).toEqual([[3, 32], [4, 42]])
    for (const call of fetchViewTasks.mock.calls) {
      const sent = createTaskCollectionSearchParams(call[2])
      expect(Number(sent.get('per_page'))).toBeLessThanOrEqual(1000)
      expect(sent.has('page')).toBe(false)
    }
  })

  it('fails the whole fetch when a project cannot be read instead of dropping its tasks', async () => {
    const fetchViews = vi.fn(async (): Promise<ApiResult<unknown[]>> => ({
      success: true,
      data: [{ id: 1, view_kind: 'list' }],
    }))
    const fetchViewTasks = vi.fn(async (projectId: number): Promise<ApiResult<unknown[]>> =>
      projectId === 4
        ? { success: false, error: 'expected number <= 1000', statusCode: 422 }
        : { success: true, data: [{ id: 1 }] })

    const result = await fetchPositionSortedTasks([3, 4], params, { fetchViews, fetchViewTasks })

    expect(result).toEqual({ success: false, error: 'expected number <= 1000', statusCode: 422 })
  })

  it('fails when the views of a project cannot be read', async () => {
    const result = await fetchPositionSortedTasks([3], params, {
      fetchViews: async () => ({ success: false, error: 'Server error' }),
      fetchViewTasks: vi.fn(),
    })

    expect(result).toEqual({ success: false, error: 'Server error' })
  })

  it('skips a project without any view', async () => {
    const result = await fetchPositionSortedTasks([3], params, {
      fetchViews: async () => ({ success: true, data: [] }),
      fetchViewTasks: vi.fn(),
    })

    expect(result).toEqual({ success: true, data: [] })
  })
})

describe('cachedFallback', () => {
  const cached = { tasks: [{ id: 1 }], timestamp: '2026-10-06T10:00:00Z' }

  it('labels an offline failure as cached without an error', () => {
    expect(cachedFallback('net::ERR_INTERNET_DISCONNECTED', cached)).toEqual({
      success: true,
      tasks: [{ id: 1 }],
      cached: true,
      cachedAt: '2026-10-06T10:00:00Z',
    })
  })

  it('serves the cached list and the error for a non-retriable failure', () => {
    expect(cachedFallback('expected number <= 1000', cached)).toEqual({
      success: true,
      tasks: [{ id: 1 }],
      cached: true,
      cachedAt: '2026-10-06T10:00:00Z',
      error: 'expected number <= 1000',
    })
  })

  it('returns null when nothing is cached so the caller reports the error', () => {
    expect(cachedFallback('Server error', { tasks: null, timestamp: null })).toBeNull()
  })
})
