/**
 * Plan my day's suggestions (docs/ai-assistant-v1.md section 10): the request's user message (10.1)
 * and the checks every answer goes through (10.3). Pinned by `planDay.checks` in
 * test-fixtures/ai-tools-v1.json; Vicu mobile implements the same rules (`PlanDayChecks.kt`).
 */
import { BLOCK_STEP_MINUTES, clockMinutes, clockText } from '../time-blocks'
import { AI_LIMITS } from './contract'
import { cutAtSpace } from './organize'
import type { LeftoverAction } from '../plan-day'

/** The `<plan>` block. */
export interface PlanBlock {
  day: string
  now: string
  default_length: number
  free: { start: string; end: string }[]
  routines: string[]
}

/** Free ranges in minutes as the request and the checks spell them. */
export function freeAsClock(ranges: readonly (readonly [number, number])[]): { start: string; end: string }[] {
  return ranges.map(([start, end]) => ({ start: clockText(start), end: clockText(end) }))
}

/** The one user message: `<context>`, `<plan>`, `<leftovers>`, `<candidates>`. */
export function planDayUserMessage(
  contextJson: string,
  plan: PlanBlock,
  leftovers: readonly object[],
  candidates: readonly object[],
): string {
  const max = AI_LIMITS.plan_day_candidates_max
  return [
    `<context>\n${contextJson}\n</context>`,
    `<plan>\n${JSON.stringify(plan)}\n</plan>`,
    `<leftovers>\n${JSON.stringify(leftovers.slice(0, max))}\n</leftovers>`,
    `<candidates>\n${JSON.stringify(candidates.slice(0, max))}\n</candidates>`,
  ].join('\n')
}

export interface PlanLeftover {
  task_id: number
  action: LeftoverAction
  reason: string
}

export interface PlanPick {
  task_id: number
  /** Null: the task takes the length it would have anyway. */
  minutes: number | null
  /** `HH:MM`, or null for the next free slot. */
  start: string | null
  reason: string
}

export interface PlanCanWait {
  task_id: number
  reason: string
}

export interface PlanDropped {
  task_id: number | null
  field: 'task_id' | 'action' | 'limit' | 'minutes' | 'start'
  value: unknown
}

export interface PlanDayResult {
  leftovers: PlanLeftover[]
  picks: PlanPick[]
  can_wait: PlanCanWait[]
  dropped: PlanDropped[]
}

export interface PlanDayCheckInput {
  /** `[start, end]` as `HH:MM`. */
  free: readonly (readonly [string, string])[]
  defaultLength: number
  leftovers: readonly number[]
  candidates: readonly number[]
}

const wholeNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const ACTIONS: readonly string[] = ['today', 'tomorrow', 'no_date', 'done']

function checkedReason(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return cutAtSpace(raw.replace(/[\r\n]+/g, ' ').trim(), AI_LIMITS.organize_reason_max_chars)
}

const entries = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []

/** Runs the checks of 10.3; anything that fails is dropped, the rest stands. */
export function checkPlanDayAnswer(answer: unknown, input: PlanDayCheckInput): PlanDayResult {
  const raw = (typeof answer === 'object' && answer !== null ? answer : {}) as Record<string, unknown>
  const dropped: PlanDropped[] = []
  const free = input.free.map(([a, b]) => [clockMinutes(a), clockMinutes(b)] as const)

  // 1. Leftovers.
  const leftoverIds = new Set(input.leftovers)
  const seenLeftovers = new Set<number>()
  const leftovers: PlanLeftover[] = []
  for (const item of entries(raw.leftovers)) {
    const id = wholeNumber(item.task_id)
    if (id === null || !leftoverIds.has(id) || seenLeftovers.has(id)) {
      dropped.push({ task_id: id, field: 'task_id', value: item.task_id ?? null })
      continue
    }
    if (typeof item.action !== 'string' || !ACTIONS.includes(item.action)) {
      dropped.push({ task_id: id, field: 'action', value: item.action ?? null })
      continue
    }
    seenLeftovers.add(id)
    leftovers.push({ task_id: id, action: item.action as LeftoverAction, reason: checkedReason(item.reason) })
  }

  // 2 to 4. Picks, their minutes and their starts.
  const candidateIds = new Set(input.candidates)
  const seenPicks = new Set<number>()
  const taken: (readonly [number, number])[] = []
  const picks: PlanPick[] = []
  for (const item of entries(raw.picks)) {
    const id = wholeNumber(item.task_id)
    if (id === null || !candidateIds.has(id) || seenPicks.has(id)) {
      dropped.push({ task_id: id, field: 'task_id', value: item.task_id ?? null })
      continue
    }
    if (picks.length >= AI_LIMITS.plan_day_picks_max) {
      dropped.push({ task_id: id, field: 'limit', value: id })
      continue
    }
    seenPicks.add(id)

    const given = wholeNumber(item.minutes)
    let minutes: number | null = null
    if (given !== null && given >= AI_LIMITS.plan_day_minutes_min && given <= AI_LIMITS.plan_day_minutes_max) {
      minutes = Math.ceil(given / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
    } else {
      dropped.push({ task_id: id, field: 'minutes', value: item.minutes ?? null })
    }

    let start: string | null = null
    if (item.start !== null && item.start !== undefined) {
      const length = minutes ?? input.defaultLength
      const from = typeof item.start === 'string' && CLOCK.test(item.start) ? clockMinutes(item.start) : null
      const fits =
        from !== null &&
        free.some(([a, b]) => from >= a && from + length <= b) &&
        !taken.some(([a, b]) => from < b && from + length > a)
      if (fits) {
        start = item.start as string
        taken.push([from, from + length])
      } else {
        dropped.push({ task_id: id, field: 'start', value: item.start })
      }
    }

    picks.push({ task_id: id, minutes, start, reason: checkedReason(item.reason) })
  }

  // 5. What can wait.
  const seenWait = new Set<number>()
  const canWait: PlanCanWait[] = []
  for (const item of entries(raw.can_wait)) {
    const id = wholeNumber(item.task_id)
    if (id === null || !candidateIds.has(id) || seenPicks.has(id) || seenWait.has(id)) {
      dropped.push({ task_id: id, field: 'task_id', value: item.task_id ?? null })
      continue
    }
    seenWait.add(id)
    canWait.push({ task_id: id, reason: checkedReason(item.reason) })
  }

  return { leftovers, picks, can_wait: canWait, dropped }
}
