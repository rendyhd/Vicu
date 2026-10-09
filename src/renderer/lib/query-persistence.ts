import { dehydrate, hydrate, type DehydratedState, type Query, type QueryClient } from '@tanstack/react-query'

// The main window starts with what it showed last time (D-SYNC-6): task lists, projects and labels
// are saved after they change and restored before the first render. Offline, or while the server is
// slow, the cached lists still render; online they refetch as soon as the views mount, because the
// restored queries keep their old `dataUpdatedAt` and so count as stale.
//
// The copy lives in IndexedDB (a few MB of tasks does not fit localStorage) and is tied to the server
// it was fetched from: another server, or a signed-out app, never restores it.

/** Query-key prefixes worth keeping. Search results and per-task details are cheap to rebuild. */
export const PERSISTED_KEY_PREFIXES: ReadonlySet<unknown> = new Set([
  'tasks',
  'view-tasks',
  'section-tasks',
  'projects',
  'labels',
  'project-views',
  'project-counts',
])

/** A saved copy older than this is not restored: it would show a long out-of-date picture. */
export const MAX_PERSISTED_AGE_MS = 14 * 24 * 60 * 60 * 1000
/** Saves are batched: a burst of updates writes once, and never later than the max wait. */
export const SAVE_DEBOUNCE_MS = 2_000
export const SAVE_MAX_WAIT_MS = 10_000
/** Above this the copy is skipped rather than slowing every save down. */
const MAX_PERSISTED_QUERIES = 400

export interface PersistedQueryCache {
  version: 1
  /** The normalized server URL the data came from. */
  server: string
  savedAt: number
  state: DehydratedState
}

/** Where the copy is kept; IndexedDB in the app, memory in tests. */
export interface PersistStore {
  read(): Promise<PersistedQueryCache | undefined>
  write(value: PersistedQueryCache): Promise<void>
  clear(): Promise<void>
}

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const [prefix, second] = query.queryKey as readonly unknown[]
  if (!PERSISTED_KEY_PREFIXES.has(prefix)) return false
  if (prefix === 'tasks' && second === 'search') return false
  return query.state.status === 'success' && query.state.data !== undefined
}

export function snapshotQueryCache(qc: QueryClient, server: string, now: number): PersistedQueryCache | null {
  const state = dehydrate(qc, { shouldDehydrateQuery: shouldPersistQuery })
  if (state.queries.length === 0 || state.queries.length > MAX_PERSISTED_QUERIES) return null
  return { version: 1, server, savedAt: now, state }
}

/** Server URLs compare without case, trailing slashes or a fragment. */
export function sameServer(a: string, b: string): boolean {
  const norm = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Put the saved copy into the query client. Returns true when something was restored. A copy from
 * another server, from a different format or older than the retention window is dropped (and
 * cleared), never shown.
 */
export async function restoreQueryCache(
  qc: QueryClient,
  store: PersistStore,
  server: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!server) {
    await store.clear().catch(() => {})
    return false
  }
  let saved: PersistedQueryCache | undefined
  try {
    saved = await store.read()
  } catch {
    return false
  }
  if (!saved) return false
  if (saved.version !== 1 || !sameServer(saved.server, server) || now - saved.savedAt > MAX_PERSISTED_AGE_MS) {
    await store.clear().catch(() => {})
    return false
  }
  try {
    hydrate(qc, saved.state)
    return true
  } catch {
    return false
  }
}

export interface PersistenceDeps {
  store: PersistStore
  /** The signed-in server, or '' when there is none (nothing is saved then). */
  getServer(): string
  now?(): number
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
}

/**
 * Save the cache after it changes: debounced, never more than `SAVE_MAX_WAIT_MS` behind. Returns a
 * function that stops it. `flush` writes right away (used when the window hides).
 */
export function startQueryPersistence(qc: QueryClient, deps: PersistenceDeps): { stop(): void; flush(): Promise<void> } {
  const now = deps.now ?? Date.now
  const setT = deps.setTimeout ?? setTimeout
  const clearT = deps.clearTimeout ?? clearTimeout
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstDirtyAt = 0

  const write = async () => {
    timer = null
    firstDirtyAt = 0
    const server = deps.getServer()
    if (!server) return
    const snapshot = snapshotQueryCache(qc, server, now())
    if (!snapshot) return
    try {
      await deps.store.write(snapshot)
    } catch {
      // A full disk or a blocked database must not break the app; the copy is only a convenience.
    }
  }

  const schedule = () => {
    const t = now()
    if (timer === null) firstDirtyAt = t
    if (timer !== null) clearT(timer)
    const wait = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, firstDirtyAt + SAVE_MAX_WAIT_MS - t))
    timer = setT(() => void write(), wait)
  }

  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') return schedule()
    if (event.type === 'updated' && (event.action.type === 'success' || event.action.type === 'setState')) schedule()
  })

  return {
    stop() {
      unsubscribe()
      if (timer !== null) clearT(timer)
      timer = null
    },
    async flush() {
      if (timer !== null) {
        clearT(timer)
        await write()
      }
    },
  }
}

// --- IndexedDB store ---------------------------------------------------------------------------

const DB_NAME = 'vicu-query-cache'
const STORE_NAME = 'cache'
const RECORD_KEY = 'main'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = run(tx.objectStore(STORE_NAME))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const indexedDbStore: PersistStore = {
  read: () => withStore('readonly', (store) => store.get(RECORD_KEY) as IDBRequest<PersistedQueryCache | undefined>),
  write: (value) => withStore('readwrite', (store) => store.put(value, RECORD_KEY)).then(() => undefined),
  clear: () => withStore('readwrite', (store) => store.delete(RECORD_KEY)).then(() => undefined),
}
