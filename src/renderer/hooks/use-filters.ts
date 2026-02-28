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

export function useFilters({
  view,
  inboxProjectId,
  projectId,
  labelId,
}: UseFiltersOptions): TaskQueryParams {
  return useMemo(() => {
    switch (view) {
      case 'inbox':
        return {
          filter: `done = false && project_id = ${inboxProjectId ?? 0}`,
          sort_by: 'created',
          order_by: 'desc',
        }

      // Today and Upcoming fetch all open tasks with a due date;
      // the views filter client-side (isToday/isOverdue in TodayView,
      // exclude today/overdue in UpcomingView) to avoid Vikunja's
      // unreliable server-side date comparison across timezones.
      case 'today':
      case 'upcoming':
        return {
          filter: `done = false && due_date != '${NULL_DATE}'`,
          sort_by: 'due_date',
          order_by: 'asc',
        }

      case 'anytime':
        return {
          filter: 'done = false',
          sort_by: 'updated',
          order_by: 'desc',
        }

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

      case 'tag':
        return {
          filter: 'done = false',
          sort_by: 'updated',
          order_by: 'desc',
        }

      default:
        return {}
    }
  }, [view, inboxProjectId, projectId, labelId])
}
