import type { ViewerFilter } from '../config'
import { MAX_PAGE_SIZE } from '../api-v2'
import { buildCustomListServerFilter } from '../../shared/custom-list-filter'
import { startOfLocalDayIso } from '../../shared/due-dates'

// Vikunja caps per_page at 1000 (anything above is a 422). No `page` is set on purpose:
// the API client then reads every page until total_pages, so lists beyond 1000 tasks
// are complete instead of silently cut off.
interface FilterParams {
  filter?: string
  sort_by: string
  order_by: string
  per_page: number
  filter_include_nulls?: string
}

/**
 * The server query for the Quick View. The filter is a superset built from local-day boundaries
 * (cross-app semantics v1, sections 2 and 3); `selectViewerTasks` applies the exact rule to
 * what comes back.
 */
export function buildViewerFilterParams(viewerFilter: ViewerFilter, now: Date = new Date()): FilterParams {
  // "Today" is everything before the start of local tomorrow.
  const tomorrowStartIso = startOfLocalDayIso(1, now)

  // Built-in view types bypass the normal filter logic
  if (viewerFilter.view_type) {
    const nullDate = '0001-01-01T00:00:00Z'
    switch (viewerFilter.view_type) {
      case 'today':
        return {
          filter: `done = false && due_date < '${tomorrowStartIso}' && due_date != '${nullDate}'`,
          sort_by: 'due_date',
          order_by: 'asc',
          per_page: MAX_PAGE_SIZE,
        }
      case 'upcoming':
        return {
          filter: `done = false && due_date >= '${tomorrowStartIso}' && due_date != '${nullDate}'`,
          sort_by: 'due_date',
          order_by: 'asc',
          per_page: MAX_PAGE_SIZE,
        }
      case 'anytime':
        return {
          filter: 'done = false',
          sort_by: 'updated',
          order_by: 'desc',
          per_page: MAX_PAGE_SIZE,
        }
    }
  }

  const hasProjects = !!viewerFilter.project_ids && viewerFilter.project_ids.length > 0
  const isUnionMode = viewerFilter.include_today_all_projects === true && hasProjects

  const sortBy = viewerFilter.sort_by || 'due_date'
  const orderBy = viewerFilter.order_by || 'asc'

  const params: FilterParams = {
    filter: buildCustomListServerFilter(viewerFilter, now),
    sort_by: sortBy,
    order_by: orderBy,
    per_page: MAX_PAGE_SIZE,
  }

  // Include nulls at end when sorting by due_date (but not in union mode)
  if (sortBy === 'due_date' && !isUnionMode) {
    params.filter_include_nulls = 'true'
  }

  return params
}
