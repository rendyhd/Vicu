import { fetchProjectTaskTotal } from './api-client'
import { loadRoutineCarriers, loadCustomListCarriers } from './carrier-service'
import { loadConfig } from './config'
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
      carrierCounts: async () => {
        const [routines, lists] = await Promise.all([loadRoutineCarriers(), loadCustomListCarriers()])
        if (!routines.success) return routines
        if (!lists.success) return lists
        return { success: true, data: countCarriersByProject([...routines.data, ...lists.data]) }
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
