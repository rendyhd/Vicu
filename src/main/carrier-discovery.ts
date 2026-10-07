/**
 * Finding the hidden "carrier" tasks (routine definitions, the synced custom lists) without paging
 * through every completed task (D-NOTIF-3, D-RT-2).
 *
 * Carriers are done tasks whose description holds a marker comment. They used to be found by
 * listing every `done = true` task, on every reminder refresh, every custom-list sync (every five
 * minutes, on focus, on resume, after each edit) and every routines query. Now:
 *
 * - The ids of the carriers seen so far are remembered per server and fetched directly, one
 *   `GET /tasks/{id}` each.
 * - New carriers (created by another device) are found with a `q` search for the marker name plus
 *   `done = true`, at most once per `DISCOVERY_INTERVAL_MS`. Vikunja 2.4 matches the marker text
 *   inside the HTML comment; a literal `<!--` matches nothing, so the search text is the marker
 *   name only. The routine search text stops after `vicu-routine:v`, which matches the main carrier
 *   (`vicu-routine:v1:...`) and not the archive parts (`vicu-routine:archive:v1:...`): the day views
 *   never download history.
 * - A full scan of the done tasks is only a fallback: when a remembered id is gone (404 or 403),
 *   and as a once-a-day safety net for servers whose search does not look into descriptions.
 *
 * Kept free of Electron so the rules run in unit tests; `carrier-service.ts` wires it to the API
 * client and the config.
 */
import { join } from 'path'
import type { ApiResult } from './api-result'
import { MAX_PAGE_SIZE } from './api-v2'
import { CUSTOM_LIST_CARRIER_SEARCH, CUSTOM_LIST_CARRIER_TITLE, hasCustomListMarker } from './custom-list-protocol'
import { JsonFileStore } from './json-file-store'
import { mapLimited } from './map-limited'
import { ROUTINE_CARRIER_SEARCH, hasRoutineMarker } from '../shared/routines'

export const DISCOVERY_INTERVAL_MS = 60_000
export const FULL_SCAN_INTERVAL_MS = 24 * 60 * 60_000
/** Remembered carriers fetched at the same time. */
const DIRECT_FETCH_CONCURRENCY = 4

export const CARRIER_IDS_FILENAME = 'carrier-ids.json'

export type CarrierKind = 'routine' | 'custom-lists'

export interface CarrierTask {
  id: number
  title?: string
  description?: string
  done?: boolean
}

export interface CarrierSpec {
  kind: CarrierKind
  /** `q` text that finds this kind's carriers (and, for routines, not the archive parts). */
  search: string
  /** True for a carrier of this kind, readable or not. */
  isCarrier(task: CarrierTask): boolean
}

export const ROUTINE_CARRIER_SPEC: CarrierSpec = {
  kind: 'routine',
  search: ROUTINE_CARRIER_SEARCH,
  isCarrier: (task) => hasRoutineMarker(task.description),
}

export const CUSTOM_LIST_CARRIER_SPEC: CarrierSpec = {
  kind: 'custom-lists',
  search: CUSTOM_LIST_CARRIER_SEARCH,
  isCarrier: (task) => task.title === CUSTOM_LIST_CARRIER_TITLE || hasCustomListMarker(task.description),
}

// --- What is remembered ------------------------------------------------------------------

export interface CarrierIdState {
  /** Carrier task ids seen on this server, ascending. */
  ids: number[]
  /** When the done tasks were last listed in full (ms since the epoch); 0 when never. */
  lastFullScanAt: number
}

export interface CarrierIdStore {
  get(server: string, kind: CarrierKind): CarrierIdState
  set(server: string, kind: CarrierKind, state: CarrierIdState): void
  /** Drop one id everywhere (the task was deleted through this app). */
  forget(id: number): void
}

const emptyState = (): CarrierIdState => ({ ids: [], lastFullScanAt: 0 })

const sameIds = (left: number[], right: number[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/** Kept in memory only; for tests and as the base of the file store. */
export function createMemoryCarrierIdStore(): CarrierIdStore {
  const states = new Map<string, CarrierIdState>()
  const key = (server: string, kind: CarrierKind) => `${kind}\n${server}`
  return {
    get: (server, kind) => {
      const state = states.get(key(server, kind))
      return state ? { ids: [...state.ids], lastFullScanAt: state.lastFullScanAt } : emptyState()
    },
    set: (server, kind, state) => {
      states.set(key(server, kind), { ids: [...state.ids], lastFullScanAt: state.lastFullScanAt })
    },
    forget: (id) => {
      for (const state of states.values()) state.ids = state.ids.filter((known) => known !== id)
    },
  }
}

type FileShape = { version: 1; servers: Record<string, Partial<Record<CarrierKind, CarrierIdState>>> }

function parseFileShape(json: unknown): FileShape {
  const servers: FileShape['servers'] = {}
  const raw = (json as { servers?: unknown } | null)?.servers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { version: 1, servers }
  for (const [server, kinds] of Object.entries(raw as Record<string, unknown>)) {
    if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) continue
    const entry: Partial<Record<CarrierKind, CarrierIdState>> = {}
    for (const kind of ['routine', 'custom-lists'] as const) {
      const state = (kinds as Record<string, unknown>)[kind] as Partial<CarrierIdState> | undefined
      if (!state || typeof state !== 'object') continue
      const ids = Array.isArray(state.ids)
        ? [...new Set(state.ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))].sort((a, b) => a - b)
        : []
      const lastFullScanAt = typeof state.lastFullScanAt === 'number' && Number.isFinite(state.lastFullScanAt) ? state.lastFullScanAt : 0
      entry[kind] = { ids, lastFullScanAt }
    }
    servers[server] = entry
  }
  return { version: 1, servers }
}

/**
 * The same, kept in `carrier-ids.json` in the user data folder. A lost or unreadable file only
 * means one discovery pass (and one full scan) on the next load, so there is no backup copy.
 */
export function createFileCarrierIdStore(path: string): CarrierIdStore {
  const file = new JsonFileStore<FileShape>({
    path,
    backup: false,
    label: 'carrier ids',
    empty: () => ({ version: 1, servers: {} }),
    parse: parseFileShape,
  })
  file.load()
  // The file is a few hundred bytes and written only when a carrier appears or disappears (or once
  // a day), so a synchronous write is simpler than an async one and leaves nothing running.
  const persist = (): void => {
    try {
      file.saveSync()
    } catch (err) {
      console.warn('[carriers] could not save carrier-ids.json:', err instanceof Error ? err.message : err)
    }
  }
  return {
    get: (server, kind) => {
      const state = file.state.servers[server]?.[kind]
      return state ? { ids: [...state.ids], lastFullScanAt: state.lastFullScanAt } : emptyState()
    },
    set: (server, kind, state) => {
      const current = file.state.servers[server]?.[kind]
      if (current && current.lastFullScanAt === state.lastFullScanAt && sameIds(current.ids, state.ids)) return
      const entry = file.state.servers[server] ?? (file.state.servers[server] = {})
      entry[kind] = { ids: [...state.ids], lastFullScanAt: state.lastFullScanAt }
      persist()
    },
    forget: (id) => {
      let changed = false
      for (const entry of Object.values(file.state.servers)) {
        for (const state of Object.values(entry)) {
          if (!state || !state.ids.includes(id)) continue
          state.ids = state.ids.filter((known) => known !== id)
          changed = true
        }
      }
      if (changed) persist()
    },
  }
}

export function carrierIdsPath(userDataDir: string): string {
  return join(userDataDir, CARRIER_IDS_FILENAME)
}

// --- The loader --------------------------------------------------------------------------

export interface CarrierLoaderDeps {
  fetchTasks(params: Record<string, unknown>): Promise<ApiResult<unknown[]>>
  fetchTaskById(id: number): Promise<ApiResult<unknown>>
  store: CarrierIdStore
  now(): number
}

export interface CarrierLoader {
  /** Every carrier of `spec.kind` on `server`, ascending by id. */
  load(spec: CarrierSpec, server: string): Promise<ApiResult<CarrierTask[]>>
  /** A carrier this app just created: fetched directly from the next load on. */
  remember(server: string, kind: CarrierKind, id: number): void
  /** A task this app deleted: never fetched again. */
  forget(id: number): void
}

function isGone(result: { statusCode?: number }): boolean {
  return result.statusCode === 404 || result.statusCode === 403
}

export function createCarrierLoader(deps: CarrierLoaderDeps): CarrierLoader {
  const lastDiscoveryAt = new Map<string, number>()
  const inFlight = new Map<string, Promise<ApiResult<CarrierTask[]>>>()
  const flightKey = (server: string, kind: CarrierKind) => `${kind}\n${server}`
  const runningScans = new Map<string, Promise<ApiResult<unknown[]>>>()

  /**
   * Every done task. The first run, a daily safety scan and a vanished carrier all scan, and the
   * routine and custom-list loads usually start together, so loads that overlap share one listing.
   * A finished listing is never reused: it would be stale for the next question.
   */
  function scanDoneTasks(server: string): Promise<ApiResult<unknown[]>> {
    const running = runningScans.get(server)
    if (running) return running
    const scan = deps.fetchTasks({ filter: 'done = true', sort_by: 'updated', order_by: 'desc', per_page: MAX_PAGE_SIZE })
    const finished = scan.finally(() => { runningScans.delete(server) })
    runningScans.set(server, finished)
    return finished
  }

  /** The tasks of a done-task listing that are carriers of this kind. */
  function carriersIn(spec: CarrierSpec, tasks: unknown[]): CarrierTask[] {
    return tasks.filter((raw): raw is CarrierTask => {
      const task = raw as CarrierTask | null
      return !!task && typeof task.id === 'number' && task.done !== false && spec.isCarrier(task)
    })
  }

  async function run(spec: CarrierSpec, server: string): Promise<ApiResult<CarrierTask[]>> {
    const key = flightKey(server, spec.kind)
    const state = deps.store.get(server, spec.kind)
    const found = new Map<number, CarrierTask>()
    let gone = false

    const direct = await mapLimited(state.ids, DIRECT_FETCH_CONCURRENCY, async (id) => ({ id, result: await deps.fetchTaskById(id) }))
    for (const { id, result } of direct) {
      if (result.success) {
        const task = result.data as CarrierTask | null
        // Reopened or rewritten into something else: it is not a carrier any more.
        if (task && task.id === id && carriersIn(spec, [task]).length === 1) found.set(id, task)
      } else if (isGone(result)) {
        gone = true
      } else {
        // Offline or a server error: nothing can be said about the carriers, keep what is remembered.
        return result
      }
    }

    const now = deps.now()
    const fullScanDue = gone || now - state.lastFullScanAt >= FULL_SCAN_INTERVAL_MS
    const searchDue = state.ids.length === 0 || now - (lastDiscoveryAt.get(key) ?? Number.NEGATIVE_INFINITY) >= DISCOVERY_INTERVAL_MS
    let lastFullScanAt = state.lastFullScanAt

    if (fullScanDue || searchDue) {
      const listing = fullScanDue
        ? await scanDoneTasks(server)
        : await deps.fetchTasks({ q: spec.search, filter: 'done = true', per_page: MAX_PAGE_SIZE })
      const listed = listing.success && Array.isArray(listing.data) ? listing.data : null
      if (listed) {
        for (const task of carriersIn(spec, listed)) found.set(task.id, task)
        lastDiscoveryAt.set(key, now)
        if (fullScanDue) lastFullScanAt = now
      } else if (found.size === 0) {
        // Nothing to fall back on. Reporting "no carriers" here could make a caller create a
        // second carrier next to one that exists.
        return listing.success ? { success: false, error: 'Unexpected response while looking for carriers' } : listing
      } else {
        console.warn(`[carriers] ${fullScanDue ? 'full scan' : 'search'} for ${spec.kind} carriers failed; using the remembered ones:`, listing.success ? 'unexpected response' : listing.error)
      }
    }

    const ids = [...found.keys()].sort((a, b) => a - b)
    deps.store.set(server, spec.kind, { ids, lastFullScanAt })
    return { success: true, data: ids.map((id) => found.get(id)!) }
  }

  return {
    load(spec, server) {
      const key = flightKey(server, spec.kind)
      const running = inFlight.get(key)
      if (running) return running
      const started = run(spec, server).finally(() => { inFlight.delete(key) })
      inFlight.set(key, started)
      return started
    },
    remember(server, kind, id) {
      const state = deps.store.get(server, kind)
      if (state.ids.includes(id)) return
      deps.store.set(server, kind, { ...state, ids: [...state.ids, id].sort((a, b) => a - b) })
    },
    forget(id) {
      deps.store.forget(id)
    },
  }
}
