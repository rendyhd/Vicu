import { app } from 'electron'
import type { ApiResult } from './api-result'
import { fetchTaskById, fetchTasks } from './api-client'
import {
  CUSTOM_LIST_CARRIER_SPEC,
  PREFS_CARRIER_SPEC,
  PRO_ARCHIVE_SPEC,
  PRO_LEDGER_SPEC,
  ROUTINE_ARCHIVE_SPEC,
  ROUTINE_CARRIER_SPEC,
  carrierIdsPath,
  createCarrierLoader,
  createFileCarrierIdStore,
  type CarrierLoader,
  type CarrierSpec,
  type CarrierTask,
} from './carrier-discovery'
import { loadConfig } from './config'
import { ensureKnownUserId } from './known-user'
import { normalizeServerUrl } from './offline/owner'

/**
 * The process-wide carrier loader: routine carriers for the reminders and the Routines views,
 * custom-list carriers for the sync, archive parts for the sidebar counts. See
 * `carrier-discovery.ts` for how they are found. Only the signed-in user's carriers are returned
 * (docs/cross-app-semantics-v1.md section 10.3); until the app knows who that is, nothing is.
 */
let loader: CarrierLoader | null = null

function getLoader(): CarrierLoader {
  if (!loader) {
    loader = createCarrierLoader({
      fetchTasks,
      fetchTaskById,
      store: createFileCarrierIdStore(carrierIdsPath(app.getPath('userData'))),
      now: () => Date.now(),
    })
  }
  return loader
}

/** The signed-in Vikunja server, normalized, or null (standalone mode, signed out). */
function currentServer(): string | null {
  const config = loadConfig()
  if (!config || config.standalone_mode || !config.vikunja_url) return null
  return normalizeServerUrl(config.vikunja_url)
}

const NOT_CONFIGURED: ApiResult<CarrierTask[]> = {
  success: false,
  error: 'Vikunja is not configured. Open Settings to connect.',
}

/**
 * The answer while the signed-in user's id is not known yet (offline before the first lookup):
 * carriers are not discovered then, so nobody else's are taken for the user's own, and a caller
 * must not read it as "there are none" (a sync would create a second carrier).
 */
export const OWNER_UNKNOWN_ERROR = 'Waiting to confirm the signed-in account'

export function isOwnerUnknown(result: ApiResult<unknown>): boolean {
  return !result.success && result.error === OWNER_UNKNOWN_ERROR
}

async function loadKind(spec: CarrierSpec): Promise<ApiResult<CarrierTask[]>> {
  const server = currentServer()
  if (!server) return NOT_CONFIGURED
  const me = await ensureKnownUserId()
  if (!me) return { success: false, error: OWNER_UNKNOWN_ERROR }
  return getLoader().load(spec, server, me)
}

export function loadRoutineCarriers(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(ROUTINE_CARRIER_SPEC)
}

export function loadRoutineArchiveParts(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(ROUTINE_ARCHIVE_SPEC)
}

export function loadCustomListCarriers(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(CUSTOM_LIST_CARRIER_SPEC)
}

export function loadPrefsCarriers(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(PREFS_CARRIER_SPEC)
}

export function loadProLedgerCarriers(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(PRO_LEDGER_SPEC)
}

export function loadProArchiveParts(): Promise<ApiResult<CarrierTask[]>> {
  return loadKind(PRO_ARCHIVE_SPEC)
}

const REMEMBERED_SPECS: readonly CarrierSpec[] = [ROUTINE_CARRIER_SPEC, ROUTINE_ARCHIVE_SPEC, CUSTOM_LIST_CARRIER_SPEC, PREFS_CARRIER_SPEC, PRO_LEDGER_SPEC, PRO_ARCHIVE_SPEC]

/**
 * A task this app just created through the API: if it is a carrier, fetch it directly from now on.
 * Returns true for a carrier, so the caller can drop the project counts, which subtract the known
 * carriers (`project-task-counts.ts`) and would otherwise count the new one as a done task.
 */
export function rememberCreatedTask(task: unknown): boolean {
  const created = task as CarrierTask | null
  const server = currentServer()
  if (!server || !created || typeof created.id !== 'number') return false
  const spec = REMEMBERED_SPECS.find((candidate) => candidate.isCarrier(created))
  if (!spec) return false
  getLoader().remember(server, spec.kind, created.id)
  return true
}

/** A task this app deleted: never look for it again (a 404 would trigger a full scan). */
export function forgetDeletedTask(id: number): void {
  getLoader().forget(id)
}
