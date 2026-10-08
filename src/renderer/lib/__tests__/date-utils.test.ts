import { describe, it, expect } from 'vitest'
import {
  formatAbsoluteDateTime,
  formatClockTime,
  formatDateChip,
  formatDueDate,
  formatMinutesOfDay,
} from '../date-utils'
import { setDateFormat } from '../date-format'
import type { DateFormat } from '../date-display'

// The phrasing rules themselves are pinned by the cross-app vectors (shared/__tests__/date-display-*);
// these tests check how the renderer helpers apply them.
const US: DateFormat = { locale: 'en-US', hour12: true }
const GB: DateFormat = { locale: 'en-GB', hour12: false }

describe('formatAbsoluteDateTime', () => {
  it('returns empty string for the Vikunja null date', () => {
    expect(formatAbsoluteDateTime('0001-01-01T00:00:00Z', US)).toBe('')
  })

  it('returns empty string for an empty value', () => {
    expect(formatAbsoluteDateTime('', US)).toBe('')
  })

  it('formats a timestamp with the year and a 12-hour clock', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:42:00', US)).toBe('Apr 13, 2026, 3:42 PM')
    expect(formatAbsoluteDateTime('2026-04-13T00:00:00', US)).toBe('Apr 13, 2026, 12:00 AM')
    expect(formatAbsoluteDateTime('2026-04-13T12:00:00', US)).toBe('Apr 13, 2026, 12:00 PM')
  })

  it('formats a timestamp day-first with a 24-hour clock', () => {
    expect(formatAbsoluteDateTime('2026-04-13T15:05:00', GB)).toBe('13 Apr 2026, 15:05')
  })
})

describe('formatDueDate', () => {
  const now = new Date(2026, 9, 6, 10, 0)

  it('shows no time for date-only values, new (23:59:59) or legacy (00:00)', () => {
    expect(formatDueDate(new Date(2026, 9, 7, 23, 59, 59).toISOString(), now, US)).toBe('Tomorrow')
    expect(formatDueDate(new Date(2026, 9, 7, 0, 0, 0).toISOString(), now, US)).toBe('Tomorrow')
  })

  it('shows the time after a comma, in the 12 or 24-hour clock', () => {
    const due = new Date(2026, 9, 7, 15, 30).toISOString()
    expect(formatDueDate(due, now, US)).toBe('Tomorrow, 3:30 PM')
    expect(formatDueDate(due, now, GB)).toBe('Tomorrow, 15:30')
  })

  it('treats 23:59 and 12:00 as explicit times', () => {
    expect(formatDueDate(new Date(2026, 9, 6, 12, 0).toISOString(), now, GB)).toBe('Today, 12:00')
    expect(formatDueDate(new Date(2026, 9, 6, 23, 59, 0).toISOString(), now, GB)).toBe('Today, 23:59')
  })

  it('phrases the past in days and keeps the year for a distant date', () => {
    expect(formatDueDate(new Date(2026, 9, 3, 23, 59, 59).toISOString(), now, US)).toBe('3 days ago')
    expect(formatDueDate(new Date(2026, 9, 9, 23, 59, 59).toISOString(), now, US)).toBe('Fri')
    expect(formatDueDate(new Date(2027, 0, 15, 9, 5).toISOString(), now, US)).toBe('Jan 15, 2027, 9:05 AM')
    expect(formatDueDate(new Date(2027, 0, 15, 9, 5).toISOString(), now, GB)).toBe('15 Jan 2027, 09:05')
  })

  it('leaves out what the surrounding view already says', () => {
    const dateOnlyToday = new Date(2026, 9, 6, 23, 59, 59).toISOString()
    const timedToday = new Date(2026, 9, 6, 15, 0).toISOString()
    expect(formatDueDate(dateOnlyToday, now, US, 'row.inToday')).toBe('')
    expect(formatDueDate(timedToday, now, US, 'row.inToday')).toBe('3:00 PM')
    expect(formatDueDate(timedToday, now, GB, 'row.inDayGroup')).toBe('15:00')
    expect(formatDueDate(dateOnlyToday, now, GB, 'row.inDayGroup')).toBe('')
  })

  it('is empty for the null date', () => {
    expect(formatDueDate('0001-01-01T00:00:00Z', now)).toBe('')
  })

  it('follows the window format when none is passed', () => {
    const due = new Date(2026, 9, 7, 15, 30).toISOString()
    setDateFormat(GB)
    expect(formatDueDate(due, now)).toBe('Tomorrow, 15:30')
    setDateFormat(US)
    expect(formatDueDate(due, now)).toBe('Tomorrow, 3:30 PM')
  })
})

describe('formatDateChip', () => {
  const now = new Date(2026, 9, 7, 9, 30)

  it('is always the weekday date, never a relative word', () => {
    const today = new Date(2026, 9, 7, 15, 0)
    expect(formatDateChip(today, false, now, GB)).toBe('Wed 7 Oct, 15:00')
    expect(formatDateChip(new Date(2026, 9, 10, 15, 0), false, now, US)).toBe('Sat, Oct 10, 3:00 PM')
    expect(formatDateChip(new Date(2026, 9, 10, 23, 59, 59), true, now, GB)).toBe('Sat 10 Oct')
  })
})

describe('clock helpers', () => {
  it('writes a time of day in the chosen clock', () => {
    const d = new Date(2026, 9, 7, 9, 5)
    expect(formatClockTime(d, US)).toBe('9:05 AM')
    expect(formatClockTime(d, GB)).toBe('09:05')
  })

  it('writes minutes after midnight in the chosen clock', () => {
    expect(formatMinutesOfDay(8 * 60 + 30, US)).toBe('8:30 AM')
    expect(formatMinutesOfDay(20 * 60, GB)).toBe('20:00')
  })
})
