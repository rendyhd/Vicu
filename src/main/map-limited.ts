/**
 * Run `fn` over `items` with at most `limit` calls in flight and return the results in the order of
 * `items`, whatever order they finish in. A call that throws rejects the whole thing; callers that
 * want to keep going return an error value instead.
 */
export async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
