import { useMemo } from 'react'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'

export type ViewType =
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'anytime'
  | 'logbook'
  | 'project'
  | 'tag'

interface UseFiltersOptions {
  view: ViewType
  inboxProjectId?: number
  projectId?: number
  labelId?: number
}

export function useFilters(options: UseFiltersOptions): TaskQueryParams {
  const { view, inboxProjectId, projectId, labelId } = options
  return useMemo(
    () => filtersFor({ view, inboxProjectId, projectId, labelId }),
    [view, inboxProjectId, projectId, labelId]
  )
}

/** The server query of a view. Pure, so what each list asks the server for is unit tested. */
export function filtersFor({
  view,
  inboxProjectId,
  projectId,
  labelId,
}: UseFiltersOptions): TaskQueryParams {
  switch (view) {
    case 'inbox':
      return {
        filter: `done = false && project_id = ${inboxProjectId ?? 0}`,
        sort_by: 'created',
        order_by: 'desc',
      }

    // Today and Upcoming fetch the open dated tasks of their own window only: the main process
    // adds the clause (`due_date < start of local tomorrow`, or `>=`) from the local-day boundary
    // when the request is made (`due_window`, src/shared/due-dates.ts), so the query key does not
    // change at midnight and the server never compares a date-only value across time zones. The
    // views still classify client-side on the local date (isOverdue/isDueToday in TodayView,
    // isUpcoming in UpcomingView), which is the exact rule; the server window is never narrower.
    case 'today':
    case 'upcoming':
      return {
        filter: `done = false && due_date != '${NULL_DATE}'`,
        due_window: view,
        sort_by: 'due_date',
        order_by: 'asc',
      }

    case 'anytime':
      return {
        filter: 'done = false',
        sort_by: 'updated',
        order_by: 'desc',
      }

    // The Logbook adds `page` and `per_page` itself (see use-logbook-tasks.ts): it loads the
    // completed tasks, newest first, a page at a time.
    case 'logbook':
      return {
        filter: 'done = true',
        sort_by: 'done_at',
        order_by: 'desc',
      }

    case 'project':
      return {
        filter: `done = false && project_id = ${projectId ?? 0}`,
        sort_by: 'created',
        order_by: 'desc',
      }

    // The server filters by label (`labels = id`). The Tag view still filters by label before
    // hiding nested subtasks, so it needs the un-nested set (a labeled subtask is shown even
    // when its parent lacks the label).
    case 'tag':
      return {
        filter: `done = false && labels = ${labelId ?? 0}`,
        sort_by: 'updated',
        order_by: 'desc',
        keep_nested_subtasks: true,
      }

    default:
      return {}
  }
}
