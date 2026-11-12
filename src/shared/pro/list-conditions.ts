/**
 * Pro's custom-list conditions (docs/cross-app-semantics-v1.md section 3.8 and 21): availability,
 * flagged, estimate, project status, promise and person, plus how the list groups and what rows
 * show. Evaluated by every version that knows them, Pro on or off (decision 23); a version that does
 * not know them keeps them and shows more. Only on the device: the server filter stays a superset.
 * Both apps run the `customListPro` vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { finalVerdictOf, recordValue, type ProLedger } from './ledger'
import { readAvailabilityView, type AvailabilityContext, type AvailabilityTask } from './availability'

export const GROUP_BY_VALUES = ['project', 'label', 'person', 'due', 'start', 'flagged', 'none'] as const
export type GroupBy = (typeof GROUP_BY_VALUES)[number]
export const ROW_FIELDS = ['project', 'labels', 'due', 'start', 'estimate', 'flag', 'notes'] as const
export type RowField = (typeof ROW_FIELDS)[number]

export interface ProListFilter {
  availability?: string
  flagged?: boolean
  estimate_max?: number
  project_status?: string
  group_by?: string
  row_fields?: string[]
  promise?: string
  person?: number[]
}

/** What the Pro conditions read; without it (no data yet) they are no condition. */
export interface ProListContext {
  availability?: AvailabilityContext | null
  ledger?: ProLedger | null
  projectOnHold?: (projectId: number) => boolean
}

export interface ProListTask extends AvailabilityTask {
  is_favorite?: boolean
}

/** Whether any Pro condition is set (the editor shows the Pro section for such a list on any device). */
export function hasProCondition(filter: ProListFilter): boolean {
  return readAvailabilityView(filter.availability) !== null ||
    typeof filter.flagged === 'boolean' ||
    readEstimateMax(filter) !== null ||
    filter.project_status === 'active' || filter.project_status === 'on_hold' ||
    filter.promise === 'theirs' || filter.promise === 'mine' || filter.promise === 'any' ||
    (Array.isArray(filter.person) && filter.person.length > 0)
}

export function readEstimateMax(filter: ProListFilter): number | null {
  return typeof filter.estimate_max === 'number' && Number.isInteger(filter.estimate_max) && filter.estimate_max >= 1 ? filter.estimate_max : null
}

export function readGroupBy(value: unknown): GroupBy {
  return (GROUP_BY_VALUES as readonly unknown[]).includes(value) ? (value as GroupBy) : 'none'
}

/** The row fields in a list's order, unknown ones left out; null when the list does not say. */
export function readRowFields(value: unknown): RowField[] | null {
  if (!Array.isArray(value)) return null
  return value.filter((field): field is RowField => (ROW_FIELDS as readonly unknown[]).includes(field))
}

/**
 * The Pro conditions for one task. `availability`: `available` keeps open tasks without a reason,
 * `remaining` open tasks, `all` (or another value) no condition. `flagged`: the favourite equals it.
 * `estimate_max`: an estimate of at most that many minutes (no estimate: no match). `project_status`:
 * `active` not on hold, `on_hold` on hold. `promise`: an open promise of that direction (`any`:
 * either). `person`: the promise's person or one of the task's labels is in the list.
 */
export function matchesProConditions(task: ProListTask, filter: ProListFilter, context: ProListContext | undefined): boolean {
  const view = readAvailabilityView(filter.availability)
  if (view === 'remaining' && task.done) return false
  if (view === 'available') {
    if (task.done) return false
    if (context?.availability && !context.availability.of(task).available) return false
  }
  if (typeof filter.flagged === 'boolean' && (task.is_favorite === true) !== filter.flagged) return false
  const estimateMax = readEstimateMax(filter)
  if (estimateMax !== null && context?.ledger) {
    const entry = context.ledger.estimates[String(task.id)]
    const minutes = entry && typeof entry[0] === 'number' ? entry[0] : null
    if (minutes === null || minutes > estimateMax) return false
  }
  if ((filter.project_status === 'active' || filter.project_status === 'on_hold') && context?.projectOnHold) {
    if (context.projectOnHold(task.project_id) !== (filter.project_status === 'on_hold')) return false
  }
  const promiseWanted = filter.promise === 'theirs' || filter.promise === 'mine' || filter.promise === 'any'
  const people = Array.isArray(filter.person) ? filter.person.filter((id) => typeof id === 'number') : []
  if ((promiseWanted || people.length) && context?.ledger) {
    const promise = recordValue(context.ledger.promises, task.id)
    const open = promise && !finalVerdictOf(promise) ? promise : null
    if (promiseWanted && (!open || (filter.promise !== 'any' && open.dir !== filter.promise))) return false
    if (people.length) {
      const byPromise = open?.person !== null && open?.person !== undefined && people.includes(open.person)
      const byLabel = (task.labels ?? []).some((label) => people.includes(label.id))
      if (!byPromise && !byLabel) return false
    }
  }
  return true
}
