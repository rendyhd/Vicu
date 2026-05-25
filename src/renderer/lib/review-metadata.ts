// Pure functions for parsing, serializing, and reasoning about the review
// marker that lives at the end of Vikunja project descriptions.
//
// Marker grammar:
//   <description>\n\n---\n**Vicu review**: <date|never|excluded>[ · every N days]
//
// See docs/superpowers/specs/2026-05-24-project-review-design.md §3.

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
  nextReviewAt: Date | null
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

export function computeStatus(
  meta: ReviewMetadata,
  globalDefaultCadenceDays: number,
  today: Date = new Date()
): ReviewStatus {
  const effectiveCadenceDays = meta.cadenceDaysOverride ?? globalDefaultCadenceDays
  const todayUtc = utcMidnight(today)

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

  const last = parseIsoDateUtc(meta.lastReviewedAt)
  const next = new Date(last)
  next.setUTCDate(next.getUTCDate() + effectiveCadenceDays)
  const daysSince = daysBetween(todayUtc, last)
  const daysUntil = daysBetween(next, todayUtc)
  return {
    metadata: meta,
    effectiveCadenceDays,
    nextReviewAt: next,
    isOverdue: daysUntil < 0,
    daysSinceReviewed: daysSince,
    daysUntilDue: daysUntil,
  }
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function parseIsoDateUtc(s: string): Date {
  const [y, m, d] = s.split('-').map((x) => parseInt(x, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 86_400_000
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY)
}

export function todayLocalIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

// "Time since reviewed" pill for the Review tree, per the redesign spec.
// Staleness severity: never / >=21d → red, >=14d → orange, else gray.
export function formatStalenessPill(status: ReviewStatus): { text: string; tone: 'red' | 'orange' | 'gray' } {
  if (status.metadata.state === 'never') return { text: 'Never reviewed', tone: 'red' }
  const days = status.daysSinceReviewed ?? 0
  if (days >= 21) return { text: `${days}d ago`, tone: 'red' }
  if (days >= 14) return { text: `${days}d ago`, tone: 'orange' }
  return { text: `${days}d ago`, tone: 'gray' }
}
