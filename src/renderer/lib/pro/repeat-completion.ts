import type { Task } from '@/lib/vikunja-types'
import { toLocalDate } from '../../../shared/due-dates'
import { catchUpPatch, completionPlan, type CompletionPlan } from '../../../shared/pro/repeat-rule'
import type { RepeatRule } from '../../../shared/pro/prefs'

/**
 * Pro's repeat rules at completion (cross-app semantics 21.13). The completion path is plain code
 * without React, so AppShell registers where the rules come from while Pro is on; without that (Pro
 * off, another window) completing is `{ done: true }` as always.
 */
export interface RepeatRuleSource {
  ruleFor(taskId: number): RepeatRule | null
  writeRule(taskId: number, rule: RepeatRule | null): void
}

let source: RepeatRuleSource | null = null

export function setRepeatRuleSource(next: RepeatRuleSource | null): void {
  source = next
}

export interface RepeatCompletion {
  plan: CompletionPlan
  rule: RepeatRule
}

/** The plan for completing this task, or null when no rule applies. */
export function repeatCompletionFor(task: Task, now = new Date()): RepeatCompletion | null {
  const rule = source?.ruleFor(task.id) ?? null
  if (!rule) return null
  const plan = completionPlan(task, rule, now)
  return plan.patches.length === 1 && plan.rule === undefined && !plan.catchUp ? null : { plan, rule }
}

/**
 * After the completion went out: stores the rule's new value and, when the rule catches up, the
 * patch that moves the reopened task to a day that is not past (null when nothing moves).
 */
export function afterRepeatCompletion(completion: RepeatCompletion, task: Task, returned: Task | null, now = new Date()): Record<string, unknown> | null {
  if (completion.plan.rule !== undefined) source?.writeRule(task.id, completion.plan.rule)
  if (!completion.plan.catchUp || !returned || returned.done) return null
  return catchUpPatch(returned, toLocalDate(now), completion.rule.until)
}
