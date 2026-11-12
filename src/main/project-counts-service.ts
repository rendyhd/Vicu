import { fetchProjectTaskTotal } from './api-client'
import { loadCustomListCarriers, loadPrefsCarriers, loadProArchiveParts, loadProLedgerCarriers, loadRoutineArchiveParts, loadRoutineCarriers } from './carrier-service'
import { loadConfig } from './config'
import { isProEnabled } from '../shared/pro/settings'
import { normalizeServerUrl } from './offline/owner'
import { countCarriersByProject, createProjectCounts, type ProjectCounts } from './project-task-counts'

/**
 * The process-wide project counts behind the sidebar progress rings. The known carriers come from
 * the carrier loader (remembered ids fetched directly), never from a listing of the done tasks.
 */
let counts: ProjectCounts | null = null

function getCounts(): ProjectCounts {
  if (!counts) {
    counts = createProjectCounts({
      fetchTotal: fetchProjectTaskTotal,
      // Every hidden done task of the user's that the app knows: routine carriers, archive parts and
      // the custom-list and preferences carriers (cross-app semantics 10.1).
      carrierCounts: async () => {
        // The Pro ledger and its archive parts only while Pro is on: a device with Pro off sends what
        // it sent before Pro (cross-app semantics 21.1, O1).
        const pro = isProEnabled(loadConfig()) ? [loadProLedgerCarriers(), loadProArchiveParts()] : []
        const loads = await Promise.all([loadRoutineCarriers(), loadRoutineArchiveParts(), loadCustomListCarriers(), loadPrefsCarriers(), ...pro])
        const failed = loads.find((result) => !result.success)
        if (failed && !failed.success) return failed
        return { success: true, data: countCarriersByProject(loads.flatMap((result) => (result.success ? result.data : []))) }
      },
      server: () => {
        const config = loadConfig()
        if (!config || config.standalone_mode || !config.vikunja_url) return null
        return normalizeServerUrl(config.vikunja_url)
      },
      now: () => Date.now(),
    })
  }
  return counts
}

export function countProjectTasks(projectId: number, done: boolean) {
  return getCounts().count(projectId, done)
}

/** A task of this project was created, completed, reopened or deleted; all projects when unknown. */
export function invalidateProjectCounts(projectId?: number): void {
  if (counts) counts.invalidate(projectId)
}
