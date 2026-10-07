import type { ApiResult } from '../api-result'

/** Quick View asks for the active projects on every refresh; a minute-old answer is plenty. */
export const ACTIVE_PROJECTS_TTL_MS = 30_000

export interface ActiveProjectIds {
  /** The ids of the active (not archived) projects of the account `key`, or null when they cannot be read. */
  get(key: string): Promise<Set<number> | null>
  /** Forget the answer (a project was created, changed or deleted, or the account changed). */
  invalidate(): void
}

/**
 * The set of active project ids, remembered briefly (D-IPC-6). Quick View used to read every page
 * of the project list on each of its refreshes (every 30 s while open, and on each show). Requests
 * that overlap share one read; a failure is never remembered.
 */
export function createActiveProjectIds(
  deps: { fetchProjects(): Promise<ApiResult<unknown[]>>; now(): number },
  ttlMs: number = ACTIVE_PROJECTS_TTL_MS
): ActiveProjectIds {
  let cached: { key: string; ids: Set<number>; at: number } | null = null
  let running: { key: string; promise: Promise<Set<number> | null> } | null = null
  let generation = 0

  return {
    async get(key) {
      if (cached && cached.key === key && deps.now() - cached.at < ttlMs) return cached.ids
      if (running && running.key === key) return running.promise

      const mine = generation
      const promise = deps.fetchProjects().then((result): Set<number> | null => {
        if (!result.success) return null
        const ids = new Set(
          (result.data as Array<{ id?: unknown }>)
            .map((project) => project.id)
            .filter((id): id is number => typeof id === 'number')
        )
        // Something changed while this was in flight: the answer may already be out of date.
        if (mine === generation) cached = { key, ids, at: deps.now() }
        return ids
      }).finally(() => {
        if (running?.promise === promise) running = null
      })
      running = { key, promise }
      return promise
    },
    invalidate() {
      generation++
      cached = null
      running = null
    },
  }
}
