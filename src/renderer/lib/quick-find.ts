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
 * list in a field). Each task once, the first copy seen; hidden metadata tasks left out.
 */
export function collectCachedTasks(cachedData: readonly unknown[]): Task[] {
  const seen = new Set<number>()
  const found: Task[] = []
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || typeof value !== 'object' || value === null) return
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isTask(entry)) {
          if (!seen.has(entry.id) && !hasVicuMetadataMarker(entry.description)) {
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

/**
 * The tasks for a query: the cached ones and the server's, each task once (the server's copy wins
 * as the fresher), ranked together. An empty query lists nothing.
 */
export function quickFindTasks(query: string, cached: readonly Task[], server: readonly Task[], limit = QUICK_FIND_LIMIT): Task[] {
  if (query.trim() === '') return []
  const byId = new Map<number, Task>()
  for (const task of cached) byId.set(task.id, task)
  for (const task of server) byId.set(task.id, task)
  return rankTasks([...byId.values()], query).slice(0, limit)
}
