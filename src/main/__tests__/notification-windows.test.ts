import { afterEach, describe, expect, it } from 'vitest'
import { notificationCategory, notificationFilters, overdueDays } from '../notification-windows'

const originalTz = process.env.TZ

function inTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  return fn()
}

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('notificationFilters', () => {
  it('splits the timeline at local midnights, with exclusive upper bounds', () => {
    inTimeZone('America/New_York', () => {
      // Tue 2026-10-06 21:00 EDT
      const filters = notificationFilters(new Date(2026, 9, 6, 21, 0))
      expect(filters.overdue).toBe('done = false && due_date < "2026-10-06T04:00:00.000Z" && due_date != "0001-01-01T00:00:00Z"')
      expect(filters.dueToday).toBe('done = false && due_date >= "2026-10-06T04:00:00.000Z" && due_date < "2026-10-07T04:00:00.000Z"')
      expect(filters.upcoming).toBe('done = false && due_date >= "2026-10-07T04:00:00.000Z" && due_date < "2026-10-08T04:00:00.000Z"')
    })
  })

  it('never uses an end-of-day <= comparison', () => {
    const filters = notificationFilters(new Date(2026, 9, 6, 9, 0))
    for (const filter of Object.values(filters)) expect(filter).not.toContain('<=')
  })
})

describe('notificationCategory', () => {
  it('buckets by local date for the morning notification', () => {
    inTimeZone('Pacific/Auckland', () => {
      const now = new Date(2026, 9, 6, 8, 0)
      expect(notificationCategory(new Date(2026, 9, 5, 23, 59, 59).toISOString(), now)).toBe('overdue')
      expect(notificationCategory(new Date(2026, 9, 6, 0, 0).toISOString(), now)).toBe('due_today')
      expect(notificationCategory(new Date(2026, 9, 6, 23, 59, 59).toISOString(), now)).toBe('due_today')
      expect(notificationCategory(new Date(2026, 9, 7, 23, 59, 59).toISOString(), now)).toBe('upcoming')
      expect(notificationCategory(new Date(2026, 9, 8, 0, 0).toISOString(), now)).toBeNull()
      expect(notificationCategory('0001-01-01T00:00:00Z', now)).toBeNull()
    })
  })

  it('keeps a task due earlier today in "due today"', () => {
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 9, 6, 16, 0)
      expect(notificationCategory(new Date(2026, 9, 6, 8, 0).toISOString(), now)).toBe('due_today')
    })
  })
})

describe('overdueDays', () => {
  it('counts calendar days, not 24-hour periods', () => {
    inTimeZone('America/New_York', () => {
      const now = new Date(2026, 9, 6, 0, 30)
      expect(overdueDays(new Date(2026, 9, 5, 23, 59, 59).toISOString(), now)).toBe(1)
      expect(overdueDays(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe(3)
      expect(overdueDays(new Date(2026, 9, 6, 8, 0).toISOString(), now)).toBe(0)
    })
  })
})
