import { isRetriableError } from '../error-classify'

export interface CachedTasks {
  tasks: unknown[] | null
  timestamp: string | null
}

export interface CachedFallbackResult {
  success: true
  tasks: unknown[]
  cached: true
  cachedAt: string | null
  /** Present only when the refresh failed for a reason other than being offline. */
  error?: string
}

/**
 * What Quick View shows when refreshing its list failed: the last good list when
 * there is one, otherwise null (the caller returns the error itself).
 *
 * Being offline (a retriable error) is expected and only labelled "cached". Any
 * other failure (a rejected request, an expired session, a server error) is passed
 * along as `error` so the popup can tell the user instead of presenting stale data
 * as current.
 */
export function cachedFallback(error: string, cached: CachedTasks): CachedFallbackResult | null {
  if (!cached.tasks) return null
  return {
    success: true,
    tasks: cached.tasks,
    cached: true,
    cachedAt: cached.timestamp,
    ...(isRetriableError(error) ? {} : { error }),
  }
}
