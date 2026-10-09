import { describe, expect, it } from 'vitest'
import { computeStatus, formatStalenessPill } from '../review-metadata'
import type { ReviewMetadata } from '../review-metadata'

// Card 1.4b (D-13): the Review tree says "Not reviewed yet" in grey, "Due" in amber when a review
// is overdue, and otherwise how long ago the last review was. Red is no longer used here.

const NOW = new Date(2026, 9, 8, 12, 0, 0)
const reviewed = (lastReviewedAt: string, cadenceDaysOverride: number | null = null): ReviewMetadata => ({
  state: 'reviewed',
  lastReviewedAt,
  cadenceDaysOverride,
})

describe('formatStalenessPill', () => {
  it('shows a grey "Not reviewed yet" for a project that was never reviewed', () => {
    const status = computeStatus({ state: 'never', lastReviewedAt: null, cadenceDaysOverride: null }, 14, NOW)
    expect(formatStalenessPill(status)).toEqual({ text: 'Not reviewed yet', tone: 'gray' })
  })

  it('shows an amber "Due" when the next review date has passed', () => {
    const status = computeStatus(reviewed('2026-09-01'), 14, NOW)
    expect(status.isOverdue).toBe(true)
    expect(formatStalenessPill(status)).toEqual({ text: 'Due', tone: 'amber' })
  })

  it('keeps a long gap grey while the cadence still covers it', () => {
    const status = computeStatus(reviewed('2026-09-01', 60), 14, NOW)
    expect(status.isOverdue).toBe(false)
    expect(formatStalenessPill(status)).toEqual({ text: '37d ago', tone: 'gray' })
  })

  it('shows how long ago a recent review was, in grey', () => {
    const status = computeStatus(reviewed('2026-10-05'), 14, NOW)
    expect(formatStalenessPill(status)).toEqual({ text: '3d ago', tone: 'gray' })
  })
})
