/**
 * Plan my day's suggestion request (docs/ai-assistant-v1.md section 10.1) from the window's
 * workspace, and the checks the answer goes through (10.3). Pure apart from the time zone name.
 */
import { checkPlanDayAnswer, freeAsClock, planDayUserMessage, type PlanDayResult } from '../../../shared/ai/plan-day'
import { organizeNotes } from '../../../shared/ai/organize'
import { clockText, type PlannerHours } from '../../../shared/time-blocks'
import type { LocalDate } from '../../../shared/due-dates'
import type { Task } from '../vikunja-types'
import { notesPlainText, summariseTask } from './task-summary'
import { dictationContextFor, type AiWorkspace } from './workspace'

export interface PlanRequestInput {
  day: LocalDate
  /** Local `YYYY-MM-DDTHH:mm:ss`, when the request is made. */
  reference: string
  defaultLength: number
  hours: PlannerHours
  /** Free ranges in minutes. */
  free: readonly (readonly [number, number])[]
  /** Routine times of the day, in minutes. No names leave the app. */
  routineMinutes: readonly number[]
  leftovers: readonly Task[]
  candidates: readonly Task[]
  /** Pro's estimates in minutes (plan 7.7.3), only while the power layer is on. */
  estimates?: ReadonlyMap<number, number>
}

/** The one user message of the request. */
export function planRequestUser(ws: AiWorkspace, input: PlanRequestInput): string {
  const contextJson = dictationContextFor(
    ws,
    { name: 'Plan', projectId: ws.inboxProjectId || null, defaultDue: null },
    input.reference,
  )
  const entry = (task: Task) => {
    const estimate = input.estimates?.get(task.id)
    return {
      ...summariseTask(task, ws),
      notes: organizeNotes(notesPlainText(task.description)),
      ...(estimate !== undefined ? { estimate_minutes: estimate } : {}),
    }
  }
  return planDayUserMessage(
    contextJson,
    {
      day: input.day,
      now: input.reference.slice(11, 16),
      default_length: input.defaultLength,
      free: freeAsClock(input.free),
      routines: [...input.routineMinutes].sort((a, b) => a - b).map(clockText),
    },
    input.leftovers.map(entry),
    input.candidates.map(entry),
  )
}

/** The checks of 10.3 on the answer. */
export function checkPlanRequest(input: PlanRequestInput, answer: unknown): PlanDayResult {
  return checkPlanDayAnswer(answer, {
    free: freeAsClock(input.free).map(({ start, end }) => [start, end] as const),
    defaultLength: input.defaultLength,
    leftovers: input.leftovers.map((task) => task.id),
    candidates: input.candidates.map((task) => task.id),
  })
}
