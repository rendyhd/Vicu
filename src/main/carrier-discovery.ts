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
 * - New carriers (created by another device) are found with a `q` search for the marker name, at
 *   most once per `DISCOVERY_INTERVAL_MS` and whenever none is known. There is no `done` filter: a
 *   carrier someone reopened in Vikunja's web UI is still the carrier, and its next write marks it
 *   done again (docs/cross-app-semantics-v1.md section 10.4). Vikunja 2.4 matches the marker text
 *   inside the HTML comment; a literal `<!--` matches nothing, so the search text is the marker
 *   name only. The routine search text stops after `vicu-routine:v`, which matches the main carrier
 *   (`vicu-routine:v1:...`) and not the archive parts (`vicu-routine:archive:v1:...`): the day views
 *   never download history.
 * - A full scan of the done tasks is only a fallback: when a remembered id is gone (404 or 403),
 *   and as a once-a-day safety net for servers whose search does not look into descriptions or
 *   answers it with an error (`isBrokenSearch`; such a search finds nothing new in between).
 *   One scan answers for every kind, and it is light for the server: flat and by id
 *   (rendyhd/Vicu#75). When it fails the search looks instead, and the next scan waits
 *   (`SCAN_RETRY_DELAYS_MS`) rather than starting from page one on the next sync.
 * - A task is a carrier when its description holds the kind's marker (never by its title) and the
 *   signed-in user created it (`created_by`, section 10.3): another user's carriers in a shared
 *   project are left alone, except a routine its owner shared (section 6.9), which every member of
 *   its project reads.
 *
 * Kept free of Electron so the rules run in unit tests; `carrier-service.ts` wires it to the API
 * client and the config.
 */
import type { ApiResult } from './api-result'
import { EXPAND_SUBTASKS_PARAM, KEEP_NESTED_SUBTASKS_PARAM, MAX_PAGE_SIZE } from './api-v2'
import { CUSTOM_LIST_CARRIER_SEARCH, hasCustomListMarker } from './custom-list-protocol'
import { mapLimited } from './map-limited'
import { isBrokenSearch } from '../shared/error-classify'
import { isOwnTask } from '../shared/hidden-tasks'
import { PREFS_CARRIER_SEARCH, hasPrefsMarker } from './synced-prefs-protocol'
import { PRO_ARCHIVE_SEARCH, PRO_LEDGER_SEARCH, hasProArchiveMarker, hasProLedgerMarker } from './pro-ledger-protocol'
import {
  ROUTINE_ARCHIVE_SEARCH,
  ROUTINE_CARRIER_SEARCH,
  hasRoutineArchiveMarker,
  hasRoutineMarker,
  isSharedRoutine,
  parseRoutineEnvelope,
} from '../shared/routines'

export const DISCOVERY_INTERVAL_MS = 60_000
export const FULL_SCAN_INTERVAL_MS = 24 * 60 * 60_000
/** Remembered carriers fetched at the same time. */
const DIRECT_FETCH_CONCURRENCY = 4
/**
 * After a full scan failed, the next one waits this long; the waits grow with each failure in a
 * row and the last one repeats. A scan that times out on a long done history must not start again
 * from page one on the next sync (rendyhd/Vicu#75).
 */
export const SCAN_RETRY_DELAYS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 60 * 60_000]

/**
 * Carriers are listed flat: never `expand=subtasks`, whose correlated subquery makes every page of a
 * long done history slow on Vikunja 2.8 and earlier (rendyhd/Vicu#75), and with nested subtasks
 * kept, because a carrier someone made a subtask is still a carrier.
 */
const FLAT_LISTING = { [EXPAND_SUBTASKS_PARAM]: false, [KEEP_NESTED_SUBTASKS_PARAM]: true }

/**
 * The full scan. By id, the primary key: the server reads each page in index order instead of
 * sorting the whole history again for every page, and a task edited during the scan does not move
 * (sorted by `updated` it would jump to the front and push a row past the page being read).
 */
const SCAN_PARAMS: Record<string, unknown> = {
  filter: 'done = true',
  sort_by: 'id',
  order_by: 'asc',
  per_page: MAX_PAGE_SIZE,
  ...FLAT_LISTING,
}

export const CARRIER_IDS_FILENAME = 'carrier-ids.json'

export type CarrierKind = 'routine' | 'routine-archive' | 'custom-lists' | 'prefs' | 'pro' | 'pro-archive'

const CARRIER_KINDS: readonly CarrierKind[] = ['routine', 'routine-archive', 'custom-lists', 'prefs', 'pro', 'pro-archive']

export interface CarrierTask {
  id: number
  title?: string
  description?: string
  done?: boolean
  project_id?: number
  created_by?: { id?: unknown } | null
}

export interface CarrierSpec {
  kind: CarrierKind
  /** `q` text that finds this kind's carriers (and, for routines, not the archive parts). */
  search: string
  /** True for a carrier of this kind, readable or not. */
  isCarrier(task: CarrierTask): boolean
  /**
   * True for a carrier of this kind that another user created and that is read all the same. Only
   * routines have one: a routine its owner shared (section 6.9). Missing: only the user's own.
   */
  isSharedByOthers?(task: CarrierTask): boolean
}

export const ROUTINE_CARRIER_SPEC: CarrierSpec = {
  kind: 'routine',
  search: ROUTINE_CARRIER_SEARCH,
  isCarrier: (task) => hasRoutineMarker(task.description),
  isSharedByOthers: (task) => {
    const payload = parseRoutineEnvelope(task.description).payload
    return !!payload && isSharedRoutine(payload)
  },
}

/** The routine archive parts: only the sidebar counts load them here (the history reads its own). */
export const ROUTINE_ARCHIVE_SPEC: CarrierSpec = {
  kind: 'routine-archive',
  search: ROUTINE_ARCHIVE_SEARCH,
  isCarrier: (task) => hasRoutineArchiveMarker(task.description),
}

/** The synced preferences (contract section 11). */
export const PREFS_CARRIER_SPEC: CarrierSpec = {
  kind: 'prefs',
  search: PREFS_CARRIER_SEARCH,
  isCarrier: (task) => hasPrefsMarker(task.description),
}

/** The Pro ledger (contract section 21.7). */
export const PRO_LEDGER_SPEC: CarrierSpec = {
  kind: 'pro',
  search: PRO_LEDGER_SEARCH,
  isCarrier: (task) => hasProLedgerMarker(task.description),
}

/** The Pro ledger's archive parts, read on demand. */
export const PRO_ARCHIVE_SPEC: CarrierSpec = {
  kind: 'pro-archive',
  search: PRO_ARCHIVE_SEARCH,
  isCarrier: (task) => hasProArchiveMarker(task.description),
}

/** By the marker only: a task the user titled like the carrier stays theirs (section 10.1). */
export const CUSTOM_LIST_CARRIER_SPEC: CarrierSpec = {
  kind: 'custom-lists',
  search: CUSTOM_LIST_CARRIER_SEARCH,
  isCarrier: (task) => hasCustomListMarker(task.description),
}

/** Every kind: a full scan records what it found for each of them. */
export const ALL_CARRIER_SPECS: readonly CarrierSpec[] = [
  ROUTINE_CARRIER_SPEC,
  ROUTINE_ARCHIVE_SPEC,
  CUSTOM_LIST_CARRIER_SPEC,
  PREFS_CARRIER_SPEC,
  PRO_LEDGER_SPEC,
  PRO_ARCHIVE_SPEC,
]

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

/** What the carrier id store keeps, whatever holds it (a file on the desktop, the browser's storage on the web). */
export type CarrierIdFile = { version: 1; servers: Record<string, Partial<Record<CarrierKind, CarrierIdState>>> }

export const emptyCarrierIdFile = (): CarrierIdFile => ({ version: 1, servers: {} })

export function parseCarrierIdFile(json: unknown): CarrierIdFile {
  const servers: CarrierIdFile['servers'] = {}
  const raw = (json as { servers?: unknown } | null)?.servers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { version: 1, servers }
  for (const [server, kinds] of Object.entries(raw as Record<string, unknown>)) {
    if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) continue
    const entry: Partial<Record<CarrierKind, CarrierIdState>> = {}
    for (const kind of CARRIER_KINDS) {
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

/** A loaded carrier id document and the way to write it back (synchronously, or queued by the host). */
export interface CarrierIdDocument {
  readonly state: CarrierIdFile
  save(): void
}

/**
 * The same, kept in a stored document: `carrier-ids.json` in the user data folder on the desktop
 * (carrier-id-file.ts), the browser's storage on the web. A lost or unreadable document only means
 * one discovery pass (and one full scan) on the next load, so there is no backup copy.
 */
export function createDocumentCarrierIdStore(file: CarrierIdDocument): CarrierIdStore {
  // The file is a few hundred bytes and written only when a carrier appears or disappears (or once
  // a day), so a synchronous write is simpler than an async one and leaves nothing running.
  const persist = (): void => {
    try {
      file.save()
    } catch (err) {
      console.warn('[carriers] could not save the carrier ids:', err instanceof Error ? err.message : err)
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


// --- The loader --------------------------------------------------------------------------

export interface CarrierLoaderDeps {
  fetchTasks(params: Record<string, unknown>): Promise<ApiResult<unknown[]>>
  fetchTaskById(id: number): Promise<ApiResult<unknown>>
  store: CarrierIdStore
  now(): number
  /** The kinds a full scan records what it found for (default: every kind). */
  specs?: readonly CarrierSpec[]
}

export interface CarrierLoader {
  /**
   * Every carrier of `spec.kind` on `server` that the user `ownerId` created (and, for routines, the
   * ones others shared, section 6.9), ascending by id, done or reopened.
   */
  load(spec: CarrierSpec, server: string, ownerId: number): Promise<ApiResult<CarrierTask[]>>
  /** A carrier this app just created: fetched directly from the next load on. */
  remember(server: string, kind: CarrierKind, id: number): void
  /** A task this app deleted: never fetched again. */
  forget(id: number): void
}

function isGone(result: { statusCode?: number }): boolean {
  return result.statusCode === 404 || result.statusCode === 403
}

export function createCarrierLoader(deps: CarrierLoaderDeps): CarrierLoader {
  const specs = deps.specs ?? ALL_CARRIER_SPECS
  const lastDiscoveryAt = new Map<string, number>()
  const inFlight = new Map<string, Promise<ApiResult<CarrierTask[]>>>()
  const flightKey = (server: string, kind: CarrierKind) => `${kind}\n${server}`
  const runningScans = new Map<string, Promise<ApiResult<unknown[]>>>()
  /** Full scans that failed in a row, per server, and when the last of them failed. */
  const scanFailures = new Map<string, { count: number; at: number }>()

  /** False while the wait after a failed scan runs (`SCAN_RETRY_DELAYS_MS`). */
  function scanAllowed(server: string, now: number): boolean {
    const failed = scanFailures.get(server)
    if (!failed) return true
    const delay = SCAN_RETRY_DELAYS_MS[Math.min(failed.count, SCAN_RETRY_DELAYS_MS.length) - 1]
    return now - failed.at >= delay
  }

  /**
   * Every done task. The first run, a daily safety scan and a vanished carrier all scan, and the
   * routine and custom-list loads usually start together, so loads that overlap share one listing.
   * A finished listing is never reused (it would be stale for the next question), but what it found
   * is remembered for every kind (`recordScan`), so one scan a day serves them all.
   */
  function scanDoneTasks(server: string, ownerId: number): Promise<ApiResult<unknown[]>> {
    const running = runningScans.get(server)
    if (running) return running
    const scan = deps.fetchTasks(SCAN_PARAMS).then((listing) => {
      const now = deps.now()
      if (listing.success && Array.isArray(listing.data)) {
        scanFailures.delete(server)
        recordScan(server, ownerId, listing.data, now)
      } else {
        scanFailures.set(server, { count: (scanFailures.get(server)?.count ?? 0) + 1, at: now })
      }
      return listing
    })
    const finished = scan.finally(() => { runningScans.delete(server) })
    runningScans.set(server, finished)
    return finished
  }

  /**
   * A scan holds every done carrier of every kind: each kind remembers the ones it found (next to
   * the ones it knew, which may have been reopened) and does not scan again for a day.
   */
  function recordScan(server: string, ownerId: number, tasks: unknown[], now: number): void {
    for (const spec of specs) {
      const state = deps.store.get(server, spec.kind)
      const ids = new Set(state.ids)
      for (const task of carriersIn(spec, tasks, ownerId)) ids.add(task.id)
      deps.store.set(server, spec.kind, { ids: [...ids].sort((a, b) => a - b), lastFullScanAt: now })
      lastDiscoveryAt.set(flightKey(server, spec.kind), now)
    }
  }

  /**
   * The tasks of a listing that are the owner's carriers of this kind, done or not, and the ones
   * another user shared when the kind has them (routines, section 6.9).
   */
  function carriersIn(spec: CarrierSpec, tasks: unknown[], ownerId: number): CarrierTask[] {
    return tasks.filter((raw): raw is CarrierTask => {
      const task = raw as CarrierTask | null
      if (!task || typeof task.id !== 'number' || !spec.isCarrier(task)) return false
      return isOwnTask(task, ownerId) || (spec.isSharedByOthers?.(task) ?? false)
    })
  }

  async function run(spec: CarrierSpec, server: string, ownerId: number): Promise<ApiResult<CarrierTask[]>> {
    const key = flightKey(server, spec.kind)
    const state = deps.store.get(server, spec.kind)
    const found = new Map<number, CarrierTask>()
    let gone = false
    // A remembered task that is not (this user's) carrier any more: it may have been replaced, so
    // look again now rather than answer "none" (another user signed in on the same server, too).
    let dropped = false

    const direct = await mapLimited(state.ids, DIRECT_FETCH_CONCURRENCY, async (id) => ({ id, result: await deps.fetchTaskById(id) }))
    for (const { id, result } of direct) {
      if (result.success) {
        const task = result.data as CarrierTask | null
        // Still a carrier when someone reopened it; not one any more when it was rewritten into
        // something else, or when it is not this user's (an id remembered before owners counted).
        if (task && task.id === id && carriersIn(spec, [task], ownerId).length === 1) found.set(id, task)
        else dropped = true
      } else if (isGone(result)) {
        gone = true
      } else {
        // Offline or a server error: nothing can be said about the carriers, keep what is remembered.
        return result
      }
    }

    const now = deps.now()
    const scanWanted = gone || now - state.lastFullScanAt >= FULL_SCAN_INTERVAL_MS
    // After a scan failed the next one waits; the search looks in the meantime.
    const fullScanDue = scanWanted && scanAllowed(server, now)
    const searchDue =
      scanWanted ||
      state.ids.length === 0 ||
      dropped ||
      now - (lastDiscoveryAt.get(key) ?? Number.NEGATIVE_INFINITY) >= DISCOVERY_INTERVAL_MS
    let lastFullScanAt = state.lastFullScanAt

    if (fullScanDue || searchDue) {
      let listing: ApiResult<unknown[]> | null = null
      let failure: ApiResult<unknown[]> | null = null
      let scanned = false
      if (fullScanDue) {
        const scan = await scanDoneTasks(server, ownerId)
        if (scan.success) {
          listing = scan
          scanned = true
        } else {
          // The scan timed out, say, on a long done history: the search is far cheaper, so it looks now.
          console.warn(`[carriers] full scan for ${spec.kind} carriers failed; searching instead:`, scan.error)
          failure = scan
        }
      }
      if (!listing) {
        const search = await deps.fetchTasks({ q: spec.search, per_page: MAX_PAGE_SIZE, ...FLAT_LISTING })
        if (search.success) {
          listing = search
        } else if (!scanWanted && isBrokenSearch(search)) {
          // The server answered the search with an error: it finds nothing new, and the scan of the
          // last day that the remembered ids come from stands in for it.
          console.warn(`[carriers] search for ${spec.kind} carriers failed; going by the last full scan:`, search.error)
          listing = { success: true, data: [] }
        } else {
          failure = failure ?? search
        }
      }
      const listed = listing && listing.success && Array.isArray(listing.data) ? listing.data : null
      if (listed) {
        for (const task of carriersIn(spec, listed, ownerId)) found.set(task.id, task)
        lastDiscoveryAt.set(key, now)
        if (scanned) lastFullScanAt = now
      } else if (found.size === 0) {
        // Nothing to fall back on. Reporting "no carriers" here could make a caller create a
        // second carrier next to one that exists.
        return failure ?? { success: false, error: 'Unexpected response while looking for carriers' }
      } else {
        const reason = failure && !failure.success ? failure.error : 'unexpected response'
        console.warn(`[carriers] looking for ${spec.kind} carriers failed; using the remembered ones:`, reason)
      }
    }

    const ids = [...found.keys()].sort((a, b) => a - b)
    deps.store.set(server, spec.kind, { ids, lastFullScanAt })
    return { success: true, data: ids.map((id) => found.get(id)!) }
  }

  return {
    load(spec, server, ownerId) {
      const key = `${flightKey(server, spec.kind)}\n${ownerId}`
      const running = inFlight.get(key)
      if (running) return running
      const started = run(spec, server, ownerId).finally(() => { inFlight.delete(key) })
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
