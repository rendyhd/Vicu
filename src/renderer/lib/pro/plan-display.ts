import type { PlanCell, PlanTask, ProjectPlan } from '../../../shared/pro/project-plan'
import type { LocalDate } from '../../../shared/due-dates'
import { isHiddenTask } from '../../../shared/hidden-tasks'

/** What the plan screens need of a task (a `Task` has all of it). */
export interface PlanSourceTask {
  id: number
  done?: boolean
  description?: string | null
  related_tasks?: { parenttask?: ReadonlyArray<{ id: number }> | null } | null
}

/** A task as the plan rules read it: its parent from `related_tasks.parenttask`. */
export function asPlanTask<T extends PlanSourceTask>(task: T): T & PlanTask {
  const parent = task.related_tasks?.parenttask?.[0]?.id
  return { ...task, parent: typeof parent === 'number' ? parent : null }
}

/**
 * The project's tasks for its plan: hidden tasks left out, in the project's displayed order (the
 * open top-level tasks as the project shows them), then the rest as they came, open before done.
 */
export function sortPlanTasks<T extends PlanSourceTask>(tasks: readonly T[], displayed: ReadonlyArray<{ id: number }>): T[] {
  const order = new Map(displayed.map((task, index) => [task.id, index]))
  return tasks
    .filter((task) => !isHiddenTask(task.description))
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const left = order.get(a.task.id)
      const right = order.get(b.task.id)
      if (left !== undefined || right !== undefined) {
        if (left === undefined) return 1
        if (right === undefined) return -1
        return left - right
      }
      if (!!a.task.done !== !!b.task.done) return a.task.done ? 1 : -1
      return a.index - b.index
    })
    .map((entry) => entry.task)
}

/**
 * What the 90-day plan screens show on top of the rules of src/shared/pro/project-plan.ts
 * (cross-app semantics 21.20): the facts of a cell in the order they are read, where today is in
 * the plan, and the name of the project a plan carries on in. Facts only, never a status.
 */

export type PlanCellFact = 'due' | 'delivered' | 'late' | 'slipped' | 'dropped'

/**
 * The facts of one cell that are above zero, in reading order. `delivered` is the ones delivered
 * on time; the late ones are their own fact (the rule counts them in both).
 */
export function cellFacts(cell: PlanCell): Array<{ fact: PlanCellFact; count: number }> {
  const facts: Array<{ fact: PlanCellFact; count: number }> = [
    { fact: 'due', count: cell.due },
    { fact: 'delivered', count: Math.max(0, cell.delivered - cell.late) },
    { fact: 'late', count: cell.late },
    { fact: 'slipped', count: cell.slipped },
    { fact: 'dropped', count: cell.dropped },
  ]
  return facts.filter((entry) => entry.count > 0)
}

/** Where today is in a plan: closed, not started, ended, or in a week (1 for the first). */
export type PlanPhase =
  | { kind: 'closed'; day: LocalDate }
  | { kind: 'before'; day: LocalDate }
  | { kind: 'after'; day: LocalDate }
  | { kind: 'week'; week: number; weeks: number }

export function planPhase(plan: Pick<ProjectPlan, 'start' | 'end' | 'closed'>, week: number | null, weeks: number, today: LocalDate): PlanPhase {
  if (plan.closed) return { kind: 'closed', day: plan.closed }
  if (today < plan.start) return { kind: 'before', day: plan.start }
  if (today > plan.end || week === null) return { kind: 'after', day: plan.end }
  return { kind: 'week', week: week + 1, weeks }
}

/**
 * The name a carried-on plan's project starts from: the old project's name without the month it
 * may already end with ("Launch February 2027" becomes "Launch"), so the new month is not added
 * after the old one.
 */
export function planNameBase(title: string, oldMonth: string): string {
  const trimmed = title.trim()
  if (!oldMonth) return trimmed
  const lower = trimmed.toLocaleLowerCase()
  const month = oldMonth.toLocaleLowerCase()
  if (lower === month || !lower.endsWith(month)) return trimmed
  return trimmed.slice(0, trimmed.length - oldMonth.length).replace(/[\s,.:;·\-–—]+$/u, '') || trimmed
}
