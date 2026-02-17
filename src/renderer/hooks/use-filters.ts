import { useMemo } from 'react'
import type { TaskQueryParams } from '@/lib/vikunja-types'
import { NULL_DATE } from '@/lib/constants'

function endOfToday(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

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
    const eot = endOfToday()

    switch (view) {
      case 'inbox':
        return {
          filter: `done = false && project_id = ${inboxProjectId ?? 0}`,
          sort_by: 'created',
          order_by: 'desc',
        }

      case 'today':
        return {
          filter: `done = false && due_date <= '${eot}' && due_date != '${NULL_DATE}'`,
          sort_by: 'due_date',
          order_by: 'asc',
        }

      case 'upcoming':
        return {
          filter: `done = false && due_date > '${eot}' && due_date != '${NULL_DATE}'`,
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
        // Label filtering must be done client-side; fetch all open tasks
        return {
          filter: 'done = false',
          sort_by: 'updated',
          order_by: 'desc',
        }

      default:
        return {}
    }
  }, [view, inboxProjectId, projectId, labelId, /* eot recalculated each render */])
}
