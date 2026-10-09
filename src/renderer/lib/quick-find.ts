import type { Task } from './vikunja-types'
import { hasVicuMetadataMarker } from './metadata-tasks'
import { rankTasks } from './search-ranking'

// Quick find and the command palette show tasks before the server has answered: they search what
// the app already holds in its query cache (every list that was opened), then merge the server's
// answer in when it arrives.

/** How long typing pauses before the server is asked. */
export const QUICK_FIND_DEBOUNCE_MS = 250

/** Most tasks Quick find lists. */
export const QUICK_FIND_LIMIT = 8

function isTask(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Task>
  return typeof candidate.id === 'number' && typeof candidate.title === 'string' && typeof candidate.project_id === 'number'
}

/**
 * Every task found in the data of cached queries, whatever the shape (a list, pages of lists, a
 * list in a field). Each task once, the first copy seen; hidden metadata tasks left out, and so are
 * tasks that only exist as a pending create (negative temp ids: opening one would ask the server
 * for a task it does not have yet) and the ids in `exclude` (tasks with a delete waiting to sync).
 */
export function collectCachedTasks(cachedData: readonly unknown[], exclude: ReadonlySet<number> = new Set()): Task[] {
  const seen = new Set<number>()
  const found: Task[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || typeof value !== 'object' || value === null) return
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isTask(entry)) {
          if (entry.id > 0 && !exclude.has(entry.id) && !seen.has(entry.id) && !hasVicuMetadataMarker(entry.description)) {
            seen.add(entry.id)
            found.push(entry)
          }
        } else {
          visit(entry, depth + 1)
        }
      }
      return
    }
    if (isTask(value)) return
    for (const entry of Object.values(value)) visit(entry, depth + 1)
  }
  for (const data of cachedData) visit(data, 0)
  return found
}

export interface QuickFindOptions {
  /** The server has answered for this very query: its list is complete, so cached-only tasks (deleted elsewhere, stale) are dropped. */
  serverAnswered?: boolean
  /** Tasks never shown (a delete is waiting to sync). */
  exclude?: ReadonlySet<number>
}

/**
 * The tasks for a query: before the server has answered, the cached ones; after, the server's list
 * (it is the whole answer, ranked the same way), each task once. An empty query lists nothing.
 */
export function quickFindTasks(
  query: string,
  cached: readonly Task[],
  server: readonly Task[],
  limit = QUICK_FIND_LIMIT,
  options: QuickFindOptions = {},
): Task[] {
  if (query.trim() === '') return []
  const exclude = options.exclude
  const byId = new Map<number, Task>()
  if (!options.serverAnswered) for (const task of cached) byId.set(task.id, task)
  for (const task of server) byId.set(task.id, task)
  const candidates = [...byId.values()].filter((task) => task.id > 0 && !exclude?.has(task.id))
  return rankTasks(candidates, query).slice(0, limit)
}
