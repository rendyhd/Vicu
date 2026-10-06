import { afterEach, describe, expect, it } from 'vitest'
import { buildViewerFilterParams } from '../filter-builder'
import type { ViewerFilter } from '../../config'

const originalTz = process.env.TZ

function inTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  return fn()
}

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const base: ViewerFilter = {
  project_ids: [],
  sort_by: 'due_date',
  order_by: 'asc',
  due_date_filter: 'all',
}

// Tue 2026-10-06 21:00 in New York (Wed 2026-10-07 01:00 UTC).
const eveningInNewYork = () => new Date(2026, 9, 6, 21, 0)

describe('built-in Today / Upcoming views use local-day boundaries (cross-app semantics v1)', () => {
  it('Today is everything before the start of local tomorrow', () => {
    inTimeZone('America/New_York', () => {
      const params = buildViewerFilterParams({ ...base, view_type: 'today' }, eveningInNewYork())
      expect(params.filter).toBe(
        "done = false && due_date < '2026-10-07T04:00:00.000Z' && due_date != '0001-01-01T00:00:00Z'",
      )
    })
  })

  it('Upcoming starts exactly where Today ends', () => {
    inTimeZone('America/New_York', () => {
      const params = buildViewerFilterParams({ ...base, view_type: 'upcoming' }, eveningInNewYork())
      expect(params.filter).toBe(
        "done = false && due_date >= '2026-10-07T04:00:00.000Z' && due_date != '0001-01-01T00:00:00Z'",
      )
    })
  })

  it('follows the local date in a zone ahead of UTC', () => {
    inTimeZone('Pacific/Auckland', () => {
      // Tue 2026-10-06 00:30 in Auckland (Mon 2026-10-05 11:30 UTC); tomorrow starts 2026-10-06 11:00Z.
      const params = buildViewerFilterParams({ ...base, view_type: 'today' }, new Date(2026, 9, 6, 0, 30))
      expect(params.filter).toContain("due_date < '2026-10-06T11:00:00.000Z'")
    })
  })

  it('uses the real UTC offset of tomorrow across a DST change', () => {
    inTimeZone('America/New_York', () => {
      // Oct 31 22:00 EDT: tomorrow (Nov 1) starts at 04:00Z. The clocks go back that night.
      const params = buildViewerFilterParams({ ...base, view_type: 'today' }, new Date(2026, 9, 31, 22, 0))
      expect(params.filter).toContain("due_date < '2026-11-01T04:00:00.000Z'")
    })
  })
})

describe('the "today" window of a custom list', () => {
  it('is bounded by the start of local tomorrow, not 23:59:59 today', () => {
    inTimeZone('America/New_York', () => {
      const params = buildViewerFilterParams({ ...base, due_date_filter: 'today' }, eveningInNewYork())
      expect(params.filter).toBe(
        "done = false && due_date < '2026-10-07T04:00:00.000Z' && due_date != '0001-01-01T00:00:00Z'",
      )
    })
  })

  it('"today from all projects" covers exactly the local day', () => {
    inTimeZone('America/New_York', () => {
      const params = buildViewerFilterParams(
        { ...base, due_date_filter: 'all', project_ids: [10], include_today_all_projects: true },
        eveningInNewYork(),
      )
      expect(params.filter).toContain("due_date >= '2026-10-06T04:00:00.000Z' && due_date < '2026-10-07T04:00:00.000Z'")
    })
  })

  it('the overdue window still ends at the start of today', () => {
    inTimeZone('America/New_York', () => {
      const params = buildViewerFilterParams({ ...base, due_date_filter: 'overdue' }, eveningInNewYork())
      expect(params.filter).toContain("due_date < '2026-10-06T04:00:00.000Z'")
    })
  })
})
