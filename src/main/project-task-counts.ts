/**
 * Per-project task counts for the sidebar progress rings (decision 11): one request that asks for
 * a page of one task and reads the `total` of the API v2 envelope, minus the hidden carrier tasks
 * the app knows about (routines, synced custom lists; they are done tasks that live in a project
 * but are not the user's tasks). Never a history scan.
 *
 * Counts are cached for ten minutes per server, project and done flag, overlapping questions share
 * one request, and a change to a project's tasks drops that project's entries. Kept free of
 * Electron so the rules run in unit tests; `project-counts-service.ts` wires it to the API client.
 */
import type { ApiResult } from './api-result'

export const PROJECT_COUNT_TTL_MS = 10 * 60_000

export interface ProjectCountDeps {
  /** The `total` of a one-task page for the project and done flag. */
  fetchTotal(projectId: number, done: boolean): Promise<ApiResult<number>>
  /** Known hidden carrier tasks (done) per project id. A failure counts as "none known". */
  carrierCounts(): Promise<ApiResult<ReadonlyMap<number, number>>>
  /** The signed-in server, or null (standalone mode, signed out). */
  server(): string | null
  now(): number
  ttlMs?: number
}

export interface ProjectCounts {
  /** The number of (not) done tasks of the project, carriers excluded. */
  count(projectId: number, done: boolean): Promise<ApiResult<number>>
  /** Drop one project's cached counts, or everything. */
  invalidate(projectId?: number): void
}

interface Entry {
  value: number
  at: number
}

export function createProjectCounts(deps: ProjectCountDeps): ProjectCounts {
  const ttl = deps.ttlMs ?? PROJECT_COUNT_TTL_MS
  const cache = new Map<string, Entry>()
  const inFlight = new Map<string, Promise<ApiResult<number>>>()
  // Bumped by invalidate(): an answer that was asked for before a change is not cached.
  let generation = 0
  // The known carriers, shared by every project's count: listed once per window, not once per project.
  let carriers: { server: string; at: number; result: ApiResult<ReadonlyMap<number, number>> } | null = null
  let carriersInFlight: Promise<ApiResult<ReadonlyMap<number, number>>> | null = null

  // Bumped by a global invalidate(): a carrier list asked for before it may lack a carrier created
  // since, so it is neither stored nor shared with a count asked for afterwards.
  let carrierGeneration = 0

  async function knownCarriers(server: string): Promise<ApiResult<ReadonlyMap<number, number>>> {
    if (carriers && carriers.server === server && carriers.result.success && deps.now() - carriers.at < ttl) return carriers.result
    if (!carriersInFlight) {
      const startedIn = carrierGeneration
      const started: Promise<ApiResult<ReadonlyMap<number, number>>> = deps.carrierCounts().then((result) => {
        if (result.success && startedIn === carrierGeneration) carriers = { server, at: deps.now(), result }
        return result
      }).finally(() => { if (carriersInFlight === started) carriersInFlight = null })
      carriersInFlight = started
    }
    return carriersInFlight
  }

  const keyOf = (server: string, projectId: number, done: boolean) => `${server}\n${projectId}\n${done ? 'done' : 'open'}`

  async function ask(server: string, key: string, projectId: number, done: boolean): Promise<ApiResult<number>> {
    const startedIn = generation
    const [total, carriers] = await Promise.all([
      deps.fetchTotal(projectId, done),
      // Open tasks are never carriers, so only a done count needs them.
      done ? knownCarriers(server) : Promise.resolve(null),
    ])
    if (!total.success) return total
    const hidden = carriers && carriers.success ? (carriers.data.get(projectId) ?? 0) : 0
    const value = Math.max(0, total.data - hidden)
    // When the carriers could not be listed the number may include them: show it, but ask again soon.
    const complete = !carriers || carriers.success
    if (complete && startedIn === generation) cache.set(key, { value, at: deps.now() })
    return { success: true, data: value }
  }

  return {
    count(projectId, done) {
      const server = deps.server()
      if (!server) return Promise.resolve({ success: false, error: 'Vikunja is not configured. Open Settings to connect.' })
      const key = keyOf(server, projectId, done)
      const cached = cache.get(key)
      if (cached && deps.now() - cached.at < ttl) return Promise.resolve({ success: true, data: cached.value })
      const running = inFlight.get(key)
      if (running) return running
      const started: Promise<ApiResult<number>> = ask(server, key, projectId, done).finally(() => {
        // An invalidation may have replaced this entry already: only remove our own.
        if (inFlight.get(key) === started) inFlight.delete(key)
      })
      inFlight.set(key, started)
      return started
    },
    invalidate(projectId) {
      generation++
      // A request that is still running was asked for before the change: a count requested now must
      // not join it and get the older number, so it is no longer shared (its own answer is not cached).
      if (projectId === undefined) {
        cache.clear()
        inFlight.clear()
        carriers = null
        carrierGeneration++
        carriersInFlight = null
        return
      }
      const needle = `\n${projectId}\n`
      for (const key of [...cache.keys()]) if (key.includes(needle)) cache.delete(key)
      for (const key of [...inFlight.keys()]) if (key.includes(needle)) inFlight.delete(key)
    },
  }
}

/** The done carrier tasks per project id; tasks without a usable project id are skipped. */
export function countCarriersByProject(carriers: ReadonlyArray<{ project_id?: number }>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const carrier of carriers) {
    const projectId = carrier.project_id
    if (typeof projectId !== 'number' || !Number.isInteger(projectId) || projectId <= 0) continue
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
  }
  return counts
}
