/**
 * The daily focus block (docs/cross-app-semantics-v1.md section 21.11): one 60 to 90 minute block a
 * day for the work that moves the top initiatives. Plan my day proposes it first. Both apps run the
 * `pro.focusBlock` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { isNoDueDate, localDateOf, type LocalDate } from '../due-dates'

export const FOCUS_BLOCK_MIN_MINUTES = 60
export const FOCUS_BLOCK_MAX_MINUTES = 90
export const FOCUS_BLOCK_CANDIDATES = 5

export interface FocusBlockTask {
  id: number
  project_id: number
  due_date?: string | null
  is_favorite?: boolean
  priority?: number | null
}

/**
 * Candidates: available tasks in ranked initiatives (the top rank first), then flagged ones outside
 * them; within that, flagged first, then due day (none last), then priority (high first), then id.
 * At most five.
 */
export function focusBlockCandidates(
  tasks: readonly FocusBlockTask[],
  initiativeRank: (projectId: number) => number | null,
): number[] {
  const due = (task: FocusBlockTask): LocalDate | null => (isNoDueDate(task.due_date) ? null : localDateOf(task.due_date))
  const eligible = tasks
    .map((task) => ({ task, rank: initiativeRank(task.project_id) }))
    .filter(({ task, rank }) => rank !== null || task.is_favorite === true)
  eligible.sort((a, b) => {
    const rankA = a.rank ?? Number.MAX_SAFE_INTEGER
    const rankB = b.rank ?? Number.MAX_SAFE_INTEGER
    if (rankA !== rankB) return rankA - rankB
    const flagA = a.task.is_favorite ? 0 : 1
    const flagB = b.task.is_favorite ? 0 : 1
    if (flagA !== flagB) return flagA - flagB
    const dueA = due(a.task)
    const dueB = due(b.task)
    if (dueA !== dueB) return dueA === null ? 1 : dueB === null ? -1 : dueA < dueB ? -1 : 1
    const priorityA = a.task.priority ?? 0
    const priorityB = b.task.priority ?? 0
    return priorityB - priorityA || a.task.id - b.task.id
  })
  return eligible.slice(0, FOCUS_BLOCK_CANDIDATES).map(({ task }) => task.id)
}

/** The block's length: the candidates' estimates added up, held between 60 and 90 minutes (60 without any). */
export function focusBlockMinutes(estimates: ReadonlyArray<number | null>): number {
  const total = estimates.reduce<number>((sum, minutes) => sum + (minutes && minutes > 0 ? minutes : 0), 0)
  if (total <= 0) return FOCUS_BLOCK_MIN_MINUTES
  return Math.min(FOCUS_BLOCK_MAX_MINUTES, Math.max(FOCUS_BLOCK_MIN_MINUTES, Math.ceil(total / 15) * 15))
}
