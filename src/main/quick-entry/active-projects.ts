import type { ApiResult } from '../api-result'

/** Quick View asks for the active projects on every refresh; a minute-old answer is plenty. */
export const ACTIVE_PROJECTS_TTL_MS = 30_000

export interface ActiveProjectEntry {
  id: number
  parent_project_id?: number | null
}

export interface ActiveProjectIds {
  /** The ids of the active (not archived) projects of the account `key`, or null when they cannot be read. */
  get(key: string): Promise<Set<number> | null>
  /**
   * The active projects with their parents (Work and Personal needs the tree), from the same read.
   * When the read fails, the last list known for this account, else null.
   */
  list(key: string): Promise<ActiveProjectEntry[] | null>
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
  let cached: { key: string; ids: Set<number>; entries: ActiveProjectEntry[]; at: number } | null = null
  let lastKnown: { key: string; entries: ActiveProjectEntry[] } | null = null
  let running: { key: string; promise: Promise<Set<number> | null> } | null = null
  let generation = 0

  return {
    async get(key) {
      if (cached && cached.key === key && deps.now() - cached.at < ttlMs) return cached.ids
      if (running && running.key === key) return running.promise

      const mine = generation
      const promise = deps.fetchProjects().then((result): Set<number> | null => {
        if (!result.success) return null
        const rows = result.data as Array<{ id?: unknown; parent_project_id?: unknown }>
        const entries: ActiveProjectEntry[] = rows
          .filter((project): project is { id: number; parent_project_id?: unknown } => typeof project.id === 'number')
          .map((project) => ({
            id: project.id,
            parent_project_id: typeof project.parent_project_id === 'number' ? project.parent_project_id : null,
          }))
        const ids = new Set(entries.map((entry) => entry.id))
        lastKnown = { key, entries }
        // Something changed while this was in flight: the answer may already be out of date.
        if (mine === generation) cached = { key, ids, entries, at: deps.now() }
        return ids
      }).finally(() => {
        if (running?.promise === promise) running = null
      })
      running = { key, promise }
      return promise
    },
    async list(key) {
      if (cached && cached.key === key && deps.now() - cached.at < ttlMs) return cached.entries
      await this.get(key)
      if (cached && cached.key === key) return cached.entries
      return lastKnown && lastKnown.key === key ? lastKnown.entries : null
    },
    invalidate() {
      generation++
      cached = null
      running = null
    },
  }
}
