import { NULL_DATE } from './constants'
import type { Task } from './vikunja-types'
import { withDueChangeRules, type BlockChanges } from '../../shared/time-blocks'

/**
 * The change as it is written: a new due date also moves or removes a block on its day (contract
 * section 16.3), in the same patch and in the optimistic cache. Every due date in the app comes
 * through here.
 */
export function withDueRules<V extends { changes: Partial<Task>; original?: Task }>(
  variables: V,
  now: Date = new Date(),
): V {
  const { changes, original } = variables
  if (!original || changes.due_date === undefined) return variables
  const applied = withDueChangeRules(original, changes as BlockChanges, now)
  if (applied === (changes as BlockChanges)) return variables
  return {
    ...variables,
    changes: {
      ...changes,
      // The cache holds the null date, and `taskPatch` sends it as null.
      start_date: applied.start_date ?? NULL_DATE,
      end_date: applied.end_date ?? NULL_DATE,
      ...(applied.reminders ? { reminders: applied.reminders as Task['reminders'] } : {}),
    },
  }
}
