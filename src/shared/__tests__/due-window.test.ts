import { afterEach, describe, expect, it } from 'vitest'
import {
  dateOnlyDue,
  dueBucket,
  dueWindowClause,
  isDueToday,
  isOverdue,
  isUpcoming,
  startOfLocalDay,
  toLocalDate,
  addLocalDays,
  withDueWindow,
} from '../due-dates'
import { compileServerFilter, type ServerFilterTask } from './server-filter-eval'
import { createTaskCollectionSearchParams } from '../../main/api-v2'

const NULL_DATE = '0001-01-01T00:00:00Z'
const originalTz = process.env.TZ

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

/** The filters the Today and Upcoming lists send: the renderer's base filter plus the window. */
function listFilters(now: Date): { today: string; upcoming: string } {
  const base = `done = false && due_date != '${NULL_DATE}'`
  return {
    today: withDueWindow(base, 'today', now)!,
    upcoming: withDueWindow(base, 'upcoming', now)!,
  }
}

function task(due: string, done = false): ServerFilterTask {
  return { done, project_id: 1, due_date: due }
}

/** Due dates around the local day boundaries of `now`, as the apps store them. */
function dueDatesAround(now: Date): string[] {
  const today = toLocalDate(now)
  const out: string[] = [NULL_DATE]
  for (let offset = -3; offset <= 4; offset++) {
    const date = addLocalDays(today, offset)
    const midnight = startOfLocalDay(date)
    out.push(
      dateOnlyDue(date), // 23:59:59 local, the date-only convention
      midnight.toISOString(), // 00:00:00, legacy date-only
      new Date(midnight.getTime() + 1_000).toISOString(), // 00:00:01
      new Date(midnight.getTime() - 1_000).toISOString(), // 23:59:59 of the day before
      new Date(midnight.getTime() + 12 * 3_600_000).toISOString(),
    )
  }
  return out
}

const ZONES = [
  'UTC',
  'America/New_York',
  'Pacific/Auckland',
  'Asia/Kolkata',
  'Europe/Amsterdam',
  'America/Los_Angeles',
  'Australia/Lord_Howe',
]

// Mid-evening, just after midnight, and the two DST changes of 2026 in the northern and southern zones.
const NOWS = [
  '2026-10-06T21:30:00',
  '2026-10-07T00:00:01',
  '2026-10-25T12:00:00', // Amsterdam: the 25-hour day
  '2026-03-29T12:00:00', // Amsterdam: the 23-hour day
  '2026-04-05T12:00:00', // Auckland: the 25-hour day
  '2026-10-04T12:00:00', // Auckland: the 23-hour day
]

describe('Today and Upcoming server windows (D-PERF-2)', () => {
  it('Today fetches everything the Today view shows (overdue and due today) and nothing later', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone
      for (const local of NOWS) {
        const now = new Date(local)
        const fetched = compileServerFilter(listFilters(now).today)
        for (const due of dueDatesAround(now)) {
          const shown = isOverdue(due, now) || isDueToday(due, now)
          expect(fetched(task(due)), `${zone} ${local} ${due}`).toBe(shown)
        }
      }
    }
  })

  it('Upcoming fetches everything the Upcoming view shows (tomorrow and later) and nothing earlier', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone
      for (const local of NOWS) {
        const now = new Date(local)
        const fetched = compileServerFilter(listFilters(now).upcoming)
        for (const due of dueDatesAround(now)) {
          expect(fetched(task(due)), `${zone} ${local} ${due}`).toBe(isUpcoming(due, now))
        }
      }
    }
  })

  it('the two windows split the dated tasks between them: none lost, none in both', () => {
    for (const zone of ZONES) {
      process.env.TZ = zone
      const now = new Date('2026-10-06T21:30:00')
      const filters = listFilters(now)
      const today = compileServerFilter(filters.today)
      const upcoming = compileServerFilter(filters.upcoming)
      for (const due of dueDatesAround(now)) {
        if (dueBucket(due, now) === 'none') {
          expect(today(task(due)) || upcoming(task(due))).toBe(false)
          continue
        }
        expect(today(task(due)) !== upcoming(task(due)), `${zone} ${due}`).toBe(true)
      }
    }
  })

  it('never fetches done tasks or tasks without a due date', () => {
    const now = new Date('2026-10-06T21:30:00')
    const filters = listFilters(now)
    for (const filter of [filters.today, filters.upcoming]) {
      const fetched = compileServerFilter(filter)
      expect(fetched(task(NULL_DATE))).toBe(false)
      expect(fetched(task('2026-10-06T10:00:00Z', true))).toBe(false)
    }
  })

  it('builds each clause from the start of local tomorrow', () => {
    process.env.TZ = 'America/New_York'
    const now = new Date('2026-10-06T21:30:00') // 21:30 EDT
    const tomorrowStart = new Date('2026-10-07T00:00:00').toISOString()
    expect(dueWindowClause('today', now)).toBe(`due_date < '${tomorrowStart}'`)
    expect(dueWindowClause('upcoming', now)).toBe(`due_date >= '${tomorrowStart}'`)
  })

  it('adds the window to the filter, or stands alone, and ignores anything it does not know', () => {
    const now = new Date('2026-10-06T10:00:00Z')
    expect(withDueWindow('done = false', 'today', now)).toBe(`done = false && ${dueWindowClause('today', now)}`)
    expect(withDueWindow(undefined, 'upcoming', now)).toBe(dueWindowClause('upcoming', now))
    expect(withDueWindow('done = false', undefined, now)).toBe('done = false')
    expect(withDueWindow('done = false', 'someday', now)).toBe('done = false')
    expect(withDueWindow(undefined, undefined, now)).toBeUndefined()
  })
})

describe('task collection query with a due window', () => {
  it('turns due_window into a filter at request time and never sends it as a parameter', () => {
    process.env.TZ = 'Europe/Amsterdam'
    const now = new Date('2026-10-06T21:30:00')
    const qs = createTaskCollectionSearchParams(
      { filter: `done = false && due_date != '${NULL_DATE}'`, due_window: 'today', sort_by: 'due_date', order_by: 'asc' },
      now,
    )
    expect(qs.get('filter')).toBe(`done = false && due_date != '${NULL_DATE}' && ${dueWindowClause('today', now)}`)
    expect(qs.has('due_window')).toBe(false)
    expect(qs.get('sort_by')).toBe('due_date')
    expect(qs.get('expand')).toBe('subtasks')
  })

  it('uses the boundary of the moment of the request: the same query a day later moves with the day', () => {
    process.env.TZ = 'Europe/Amsterdam'
    const params = { filter: 'done = false', due_window: 'upcoming' }
    const before = createTaskCollectionSearchParams(params, new Date('2026-10-06T21:30:00')).get('filter')
    const after = createTaskCollectionSearchParams(params, new Date('2026-10-07T00:00:05')).get('filter')
    expect(before).not.toBe(after)
    expect(after).toContain(new Date('2026-10-08T00:00:00').toISOString())
  })

  it('leaves a query without a window alone', () => {
    const qs = createTaskCollectionSearchParams({ filter: 'done = false', per_page: 50 })
    expect(qs.get('filter')).toBe('done = false')
    expect(qs.get('per_page')).toBe('50')
  })
})
