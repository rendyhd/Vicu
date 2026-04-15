import { describe, it, expect } from 'vitest'
import { formatAbsoluteDateTime } from '../date-utils'

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
