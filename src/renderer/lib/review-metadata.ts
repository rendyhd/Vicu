// Pure functions for parsing, serializing, and reasoning about the review
// marker that lives at the end of Vikunja project descriptions.
//
// Marker grammar:
//   <description>\n\n---\n**Vicu review**: <date|never|excluded>[ · every N days]
//
// See docs/superpowers/specs/2026-05-24-project-review-design.md §3.
// Status math follows docs/cross-app-semantics-v1.md section 4: local calendar dates only.

import { addLocalDays, diffLocalDays, toLocalDate } from './due-dates'

export const REVIEW_MARKER_PREFIX = '**Vicu review**:'
export const REVIEW_MARKER_SEPARATOR = '---'
export const REVIEW_MIDDLE_DOT = '·'

export type ReviewState = 'never' | 'reviewed' | 'excluded'

export interface ReviewMetadata {
  state: ReviewState
  lastReviewedAt: string | null
  cadenceDaysOverride: number | null
}

export interface ReviewStatus {
  metadata: ReviewMetadata
  effectiveCadenceDays: number
  /** Local `YYYY-MM-DD` of the next review (last reviewed + cadence), null for never/excluded. */
  nextReviewAt: string | null
  isOverdue: boolean
  daysSinceReviewed: number | null
  daysUntilDue: number | null
}

// Anchors at end-of-string ($) and dot doesn't cross newlines, so only the
// final marker block in a description matches — multi-marker descriptions
// resolve to the last block, per spec.
const MARKER_REGEX = /(?:^|\n)---\s*\n\*\*Vicu review\*\*:\s*(.+?)\s*$/

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CADENCE_REGEX = /^every\s+(\d+)\s*(d|day|days|w|week|weeks)$/i

function defaultMeta(): ReviewMetadata {
  return { state: 'never', lastReviewedAt: null, cadenceDaysOverride: null }
}

export function parseReviewFooter(description: string | null | undefined): ReviewMetadata {
  if (!description) return defaultMeta()
  const match = description.match(MARKER_REGEX)
  if (!match) return defaultMeta()
  const value = match[1].trim()
  const parts = value.split(/\s*·\s*|\s+\|\s+/).map((p) => p.trim())
  const [first, second] = parts

  let state: ReviewState
  let lastReviewedAt: string | null = null
  if (/^excluded$/i.test(first)) {
    state = 'excluded'
  } else if (/^never$/i.test(first)) {
    state = 'never'
  } else if (ISO_DATE.test(first)) {
    state = 'reviewed'
    lastReviewedAt = first
  } else {
    console.warn('[review-metadata] malformed marker value:', value)
    return defaultMeta()
  }

  let cadenceDaysOverride: number | null = null
  if (second) {
    const cadenceMatch = second.match(CADENCE_REGEX)
    if (cadenceMatch) {
      const n = parseInt(cadenceMatch[1], 10)
      const unit = cadenceMatch[2].toLowerCase()
      cadenceDaysOverride = unit.startsWith('w') ? n * 7 : n
    } else {
      console.warn('[review-metadata] malformed cadence segment:', second)
    }
  }

  return { state, lastReviewedAt, cadenceDaysOverride }
}

export function serializeReviewFooter(meta: ReviewMetadata): string {
  if (meta.state === 'excluded') return `${REVIEW_MARKER_PREFIX} excluded`
  const head = meta.state === 'reviewed' && meta.lastReviewedAt ? meta.lastReviewedAt : 'never'
  if (meta.cadenceDaysOverride && meta.cadenceDaysOverride > 0) {
    return `${REVIEW_MARKER_PREFIX} ${head} ${REVIEW_MIDDLE_DOT} every ${meta.cadenceDaysOverride} days`
  }
  return `${REVIEW_MARKER_PREFIX} ${head}`
}

export function stripFooter(description: string | null | undefined): string {
  if (!description) return ''
  return description.replace(MARKER_REGEX, '').replace(/\s+$/, '')
}

export function upsertFooter(description: string | null | undefined, meta: ReviewMetadata): string {
  const body = stripFooter(description)
  const footer = `---\n${serializeReviewFooter(meta)}`
  if (body.length === 0) return footer
  return `${body}\n\n${footer}`
}

/** Whether a description ends in a review footer at all (a missing footer reads as "never"). */
export function hasReviewFooter(description: string | null | undefined): boolean {
  return !!description && MARKER_REGEX.test(description)
}

/**
 * Put the review footer of `previousDescription` onto `description`: the current text stays,
 * only the footer goes back to what it was (no footer at all when there was none). Used by undo
 * so it never rolls back a description edit made in the meantime.
 */
export function restoreFooter(description: string | null | undefined, previousDescription: string | null | undefined): string {
  if (!hasReviewFooter(previousDescription)) return stripFooter(description)
  return upsertFooter(description, parseReviewFooter(previousDescription))
}

/**
 * Review status on local calendar dates (docs/cross-app-semantics-v1.md section 4):
 * `next = last + cadence`, `daysSince = today - last`, `daysUntil = next - today`, overdue when
 * `daysUntil < 0`. `today` is the local date of `now`, so the answer never flips at UTC midnight
 * and always matches Android.
 */
export function computeStatus(
  meta: ReviewMetadata,
  globalDefaultCadenceDays: number,
  now: Date = new Date()
): ReviewStatus {
  const effectiveCadenceDays = meta.cadenceDaysOverride ?? globalDefaultCadenceDays

  if (meta.state === 'excluded') {
    return {
      metadata: meta,
      effectiveCadenceDays,
      nextReviewAt: null,
      isOverdue: false,
      daysSinceReviewed: null,
      daysUntilDue: null,
    }
  }

  if (meta.state === 'never' || !meta.lastReviewedAt) {
    return {
      metadata: meta,
      effectiveCadenceDays,
      nextReviewAt: null,
      isOverdue: true,
      daysSinceReviewed: null,
      daysUntilDue: null,
    }
  }

  const today = toLocalDate(now)
  const last = meta.lastReviewedAt
  const next = addLocalDays(last, effectiveCadenceDays)
  const daysUntil = diffLocalDays(today, next)
  return {
    metadata: meta,
    effectiveCadenceDays,
    nextReviewAt: next,
    isOverdue: daysUntil < 0,
    daysSinceReviewed: diffLocalDays(last, today),
    daysUntilDue: daysUntil,
  }
}

export function todayLocalIsoDate(now: Date = new Date()): string {
  return toLocalDate(now)
}

export function formatLastReviewedLabel(status: ReviewStatus): string {
  if (status.metadata.state === 'excluded') return 'Excluded from review'
  if (status.metadata.state === 'never') return 'Never reviewed'
  const days = status.daysSinceReviewed ?? 0
  if (days === 0) return 'Reviewed today'
  if (days === 1) return 'Reviewed yesterday'
  return `Reviewed ${days} days ago`
}

export function formatStatusPill(status: ReviewStatus): { label: string; tone: 'red' | 'amber' | 'gray' | 'gray-muted' } {
  if (status.metadata.state === 'excluded') return { label: 'Excluded', tone: 'gray-muted' }
  if (status.metadata.state === 'never') return { label: 'Never reviewed', tone: 'red' }
  const d = status.daysUntilDue ?? 0
  if (d < 0) return { label: `Overdue ${Math.abs(d)}d`, tone: 'red' }
  if (d === 0) return { label: 'Due today', tone: 'amber' }
  return { label: `Due in ${d}d`, tone: 'gray' }
}

// Pill for the Review tree (design review D-13). A project that was never reviewed is grey, not an
// alarm; an overdue review is the one amber state ("Due"); anything else says how long ago.
export function formatStalenessPill(status: ReviewStatus): { text: string; tone: 'amber' | 'gray' } {
  if (status.metadata.state === 'never') return { text: 'Not reviewed yet', tone: 'gray' }
  if (status.isOverdue) return { text: 'Due', tone: 'amber' }
  return { text: `${status.daysSinceReviewed ?? 0}d ago`, tone: 'gray' }
}
