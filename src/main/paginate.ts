import type { ApiResult } from './api-result'
import { MAX_PAGE_SIZE } from './api-v2'

/**
 * Safety valve against a server that never ends a collection. Reaching it is
 * reported as an error instead of quietly returning a truncated list.
 */
export const MAX_PAGES = 1000

export interface PageEnvelope<T> {
  items: T[] | null
  page?: number
  per_page?: number
  total_pages?: number
}

interface CollectOptions {
  /** The page size that was requested. Used only when the response omits `per_page`. */
  pageSize?: number
  maxPages?: number
}

function itemId(item: unknown): number | null {
  if (!item || typeof item !== 'object') return null
  const id = (item as { id?: unknown }).id
  return typeof id === 'number' ? id : null
}

/**
 * Fetch every page of a collection.
 *
 * Pagination ends, in order of authority, when:
 * - a page comes back empty,
 * - `total_pages` says the last page was reached,
 * - `total_pages` is missing and the page was shorter than the page size, or
 * - a page adds nothing new (a server that ignores `page`).
 *
 * Results are de-duplicated by `id` because rows can shift between pages while
 * we iterate. Callers must filter the *complete* list afterwards: filtering a
 * page before deciding whether to continue shrinks the page and ends
 * pagination early (D-REN-1).
 */
export async function collectAllPages<T>(
  fetchPage: (page: number) => Promise<ApiResult<PageEnvelope<T>>>,
  { pageSize = MAX_PAGE_SIZE, maxPages = MAX_PAGES }: CollectOptions = {}
): Promise<ApiResult<T[]>> {
  const all: T[] = []
  const seen = new Set<number>()

  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(page)
    if (!result.success) return result

    const batch = result.data.items ?? []
    if (batch.length === 0) return { success: true, data: all }

    let added = 0
    for (const item of batch) {
      const id = itemId(item)
      if (id !== null) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      all.push(item)
      added++
    }
    if (added === 0) return { success: true, data: all }

    const totalPages = result.data.total_pages
    if (typeof totalPages === 'number' && Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) return { success: true, data: all }
    } else {
      const serverPageSize = result.data.per_page
      const effectiveSize =
        typeof serverPageSize === 'number' && serverPageSize > 0 ? serverPageSize : pageSize
      if (batch.length < effectiveSize) return { success: true, data: all }
    }
  }

  console.warn(`[api] Stopped paginating after ${maxPages} pages; the server kept returning results`)
  return {
    success: false,
    error: `Stopped after ${maxPages} pages because the server kept returning results.`,
  }
}
