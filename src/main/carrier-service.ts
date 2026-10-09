import { app } from 'electron'
import type { ApiResult } from './api-result'
import { fetchTaskById, fetchTasks } from './api-client'
import {
  CUSTOM_LIST_CARRIER_SPEC,
  ROUTINE_CARRIER_SPEC,
  carrierIdsPath,
  createCarrierLoader,
  createFileCarrierIdStore,
  type CarrierLoader,
  type CarrierTask,
} from './carrier-discovery'
import { loadConfig } from './config'
import { normalizeServerUrl } from './offline/owner'

/**
 * The process-wide carrier loader: routine carriers for the reminders and the Routines views,
 * custom-list carriers for the sync. See `carrier-discovery.ts` for how they are found.
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

export function loadRoutineCarriers(): Promise<ApiResult<CarrierTask[]>> {
  const server = currentServer()
  return server ? getLoader().load(ROUTINE_CARRIER_SPEC, server) : Promise.resolve(NOT_CONFIGURED)
}

export function loadCustomListCarriers(): Promise<ApiResult<CarrierTask[]>> {
  const server = currentServer()
  return server ? getLoader().load(CUSTOM_LIST_CARRIER_SPEC, server) : Promise.resolve(NOT_CONFIGURED)
}

/**
 * A task this app just created through the API: if it is a carrier, fetch it directly from now on.
 * Returns true for a carrier, so the caller can drop the project counts, which subtract the known
 * carriers (`project-task-counts.ts`) and would otherwise count the new one as a done task.
 */
export function rememberCreatedTask(task: unknown): boolean {
  const created = task as CarrierTask | null
  const server = currentServer()
  if (!server || !created || typeof created.id !== 'number') return false
  if (ROUTINE_CARRIER_SPEC.isCarrier(created)) {
    getLoader().remember(server, 'routine', created.id)
    return true
  }
  if (CUSTOM_LIST_CARRIER_SPEC.isCarrier(created)) {
    getLoader().remember(server, 'custom-lists', created.id)
    return true
  }
  return false
}

/** A task this app deleted: never look for it again (a 404 would trigger a full scan). */
export function forgetDeletedTask(id: number): void {
  getLoader().forget(id)
}
