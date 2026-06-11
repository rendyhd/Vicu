interface FetchAllPagesOptions {
  pageSize: number
  /** Hard stop — protects against runaway loops on servers that always fill pages. */
  maxPages?: number
}

/**
 * Fetch pages 1..N until a page comes back shorter than pageSize.
 * Dedupes by `id` because rows can shift between pages while iterating.
 */
export async function fetchAllPages<T extends { id: number }>(
  fetchPage: (page: number) => Promise<T[]>,
  { pageSize, maxPages = 20 }: FetchAllPagesOptions
): Promise<T[]> {
  const all: T[] = []
  const seen = new Set<number>()
  for (let page = 1; page <= maxPages; page++) {
    const batch = await fetchPage(page)
    for (const item of batch) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        all.push(item)
      }
    }
    if (batch.length < pageSize) break
  }
  return all
}
