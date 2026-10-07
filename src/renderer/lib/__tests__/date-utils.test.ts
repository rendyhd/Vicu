import { describe, it, expect } from 'vitest'
import { formatAbsoluteDateTime, formatDueDate, formatRelativeDate } from '../date-utils'

describe('formatAbsoluteDateTime', () => {
  it('returns empty string for the Vikunja null date', () => {
    expect(formatAbsoluteDateTime('0001-01-01T00:00:00Z')).toBe('')
  })

  it('returns empty string for an empty string', () => {
    expect(formatAbsoluteDateTime('')).toBe('')
  })

  it('formats a local-time ISO string as "MMM d, yyyy at h:mm a"', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:42:00')).toBe('Apr 13, 2026 at 3:42 PM')
  })

  it('pads minutes with a leading zero', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:05:00')).toBe('Apr 13, 2026 at 3:05 PM')
  })

  it('renders midnight as 12:00 AM', () => {
    expect(formatAbsoluteDateTime('2026-04-13T00:00:00')).toBe('Apr 13, 2026 at 12:00 AM')
  })

  it('renders noon as 12:00 PM', () => {
    expect(formatAbsoluteDateTime('2026-04-13T12:00:00')).toBe('Apr 13, 2026 at 12:00 PM')
  })
})

describe('formatRelativeDate', () => {
  const now = new Date(2026, 9, 6, 10, 0) // Tue 2026-10-06 10:00 local

  it('names today, tomorrow and yesterday by local date, whatever the time of day', () => {
    expect(formatRelativeDate(new Date(2026, 9, 6, 23, 59, 59).toISOString(), now)).toBe('Today')
    expect(formatRelativeDate(new Date(2026, 9, 6, 8, 0).toISOString(), now)).toBe('Today')
    expect(formatRelativeDate(new Date(2026, 9, 7, 0, 0).toISOString(), now)).toBe('Tomorrow')
    expect(formatRelativeDate(new Date(2026, 9, 5, 23, 59, 59).toISOString(), now)).toBe('Yesterday')
  })

  it('shows a weekday within the coming week and a date after that', () => {
    expect(formatRelativeDate(new Date(2026, 9, 9, 23, 59, 59).toISOString(), now)).toBe('Fri')
    expect(formatRelativeDate(new Date(2026, 9, 20, 23, 59, 59).toISOString(), now)).toBe('Oct 20')
  })

  it('shows the year only outside the current year', () => {
    expect(formatRelativeDate(new Date(2026, 11, 24, 23, 59, 59).toISOString(), now)).toBe('Dec 24')
    expect(formatRelativeDate(new Date(2027, 0, 15, 23, 59, 59).toISOString(), now)).toBe('Jan 15, 2027')
    expect(formatRelativeDate(new Date(2025, 11, 31, 23, 59, 59).toISOString(), now)).toBe('Dec 31, 2025')
  })

  it('is empty for the null date', () => {
    expect(formatRelativeDate('0001-01-01T00:00:00Z', now)).toBe('')
  })
})

describe('formatDueDate', () => {
  const now = new Date(2026, 9, 6, 10, 0)

  it('shows no time for date-only values, new (23:59:59) or legacy (00:00)', () => {
    expect(formatDueDate(new Date(2026, 9, 7, 23, 59, 59).toISOString(), now, 'en-US')).toBe('Tomorrow')
    expect(formatDueDate(new Date(2026, 9, 7, 0, 0, 0).toISOString(), now, 'en-US')).toBe('Tomorrow')
  })

  it('shows the time for an explicit time, in the locale 12/24-hour style', () => {
    const due = new Date(2026, 9, 7, 15, 30).toISOString()
    expect(formatDueDate(due, now, 'en-US')).toMatch(/^Tomorrow 3:30\sPM$/)
    expect(formatDueDate(due, now, 'de-DE')).toBe('Tomorrow 15:30')
  })

  it('treats 23:59 and 12:00 as explicit times', () => {
    expect(formatDueDate(new Date(2026, 9, 6, 12, 0).toISOString(), now, 'de-DE')).toBe('Today 12:00')
    expect(formatDueDate(new Date(2026, 9, 6, 23, 59, 0).toISOString(), now, 'de-DE')).toBe('Today 23:59')
  })

  it('keeps the year for a distant explicit time', () => {
    expect(formatDueDate(new Date(2027, 0, 15, 9, 5).toISOString(), now, 'de-DE')).toBe('Jan 15, 2027 9:05')
  })

  it('is empty for the null date', () => {
    expect(formatDueDate('0001-01-01T00:00:00Z', now)).toBe('')
  })
})
