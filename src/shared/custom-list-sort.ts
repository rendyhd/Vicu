/**
 * How a custom list is ordered, shared by the main window and Quick View and the same as Android
 * (`CustomListFilterBuilder.sortTasks`; both run the same cases). The server's own sort is not
 * relied on: it places tasks without a date differently per database, and `position` has no
 * meaning outside a project view (`GET /tasks?sort_by=position` is a 400).
 *
 * - Sort keys (section 3.6): due_date, start_date, end_date, created, updated, done_at, priority,
 *   percent_done, title, done, id, position. Any other first key means last updated first; a
 *   further key (`then_by`) this version does not know is skipped.
 * - Dates compare as instants, not as text ("...:00.500Z" is after "...:00Z"). A task without that
 *   date (empty, the Vikunja null date, or unreadable) comes last in both directions, so tasks
 *   without a due date never lead a descending list.
 * - Titles compare case-insensitively.
 * - Tasks that tie keep their order, in both directions (the sort is stable and the direction
 *   flips the comparison, not the result).
 * - The order is `desc` (any case) or ascending.
 *
 * No imports, so any tsconfig can include it.
 */

/** The fields of a Vikunja task the sort reads. */
export interface CustomListSortable {
  id?: number
  title?: string
  done?: boolean
  priority?: number
  percent_done?: number
  position?: number
  due_date?: string | null
  start_date?: string | null
  end_date?: string | null
  created?: string | null
  updated?: string | null
  done_at?: string | null
}

/** A further sort key (section 3.6). */
export interface CustomListSortKey { sort_by: string; order_by?: string }

/** The keys the sort understands, in the order the list editor offers them. */
export const CUSTOM_LIST_SORT_KEYS = [
  'due_date', 'start_date', 'end_date', 'created', 'updated', 'done_at', 'priority',
  'percent_done', 'title', 'done', 'id', 'position',
] as const

/** The instant of Vikunja's null date; no real date is at or before it. */
const NULL_DATE_MS = Date.parse('0001-01-01T00:00:00Z')

/** Milliseconds since the epoch, or null for a missing, null or unreadable date. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) || ms <= NULL_DATE_MS ? null : ms
}

type Comparator<T> = (a: T, b: T) => number

function byDate<T>(descending: boolean, date: (task: T) => string | null | undefined): Comparator<T> {
  return (a, b) => {
    const left = instantOf(date(a))
    const right = instantOf(date(b))
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1
    return descending ? right - left : left - right
  }
}

function byKey<T, K extends number | string>(descending: boolean, key: (task: T) => K): Comparator<T> {
  return (a, b) => {
    const left = key(a)
    const right = key(b)
    const diff = left < right ? -1 : left > right ? 1 : 0
    return descending ? -diff : diff
  }
}

/** The order of one key, or null for a key this version does not know. */
function comparatorFor<T extends CustomListSortable>(sortBy: string, orderBy: string | undefined): Comparator<T> | null {
  const descending = (orderBy ?? '').toLowerCase() === 'desc'
  switch (sortBy) {
    case 'due_date':
      return byDate(descending, (task) => task.due_date)
    case 'start_date':
      return byDate(descending, (task) => task.start_date)
    case 'end_date':
      return byDate(descending, (task) => task.end_date)
    case 'created':
      return byDate(descending, (task) => task.created)
    case 'updated':
      return byDate(descending, (task) => task.updated)
    case 'done_at':
      return byDate(descending, (task) => task.done_at)
    case 'priority':
      return byKey(descending, (task) => task.priority ?? 0)
    case 'percent_done':
      return byKey(descending, (task) => task.percent_done ?? 0)
    case 'title':
      return byKey(descending, (task) => (task.title ?? '').toLowerCase())
    case 'done':
      return byKey(descending, (task) => (task.done ? 1 : 0))
    case 'id':
      return byKey(descending, (task) => task.id ?? 0)
    case 'position':
      return byKey(descending, (task) => task.position ?? 0)
    default:
      return null
  }
}

/** A sorted copy of `tasks`, by `sortBy` and then each `thenBy` key; the list given is not changed. */
export function sortCustomListTasks<T extends CustomListSortable>(
  tasks: readonly T[],
  sortBy: string,
  orderBy: string,
  thenBy: readonly CustomListSortKey[] = [],
): T[] {
  const comparators: Comparator<T>[] = [comparatorFor<T>(sortBy, orderBy) ?? byDate(true, (task) => task.updated)]
  for (const key of thenBy) {
    const next = comparatorFor<T>(key.sort_by, key.order_by)
    if (next) comparators.push(next)
  }
  const comparator: Comparator<T> = (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b)
      if (result !== 0) return result
    }
    return 0
  }
  // Array.prototype.sort is stable: ties keep the order they came in.
  return [...tasks].sort(comparator)
}

/** The sort keys `GET /tasks` accepts. `position` is not one of them without a project view. */
const SERVER_SORT_KEYS: ReadonlySet<string> = new Set(['due_date', 'created', 'updated', 'priority', 'title', 'done_at'])

/**
 * The `sort_by` and `order_by` to send with a custom list's query, or nothing when the server
 * would refuse the key (`position`, or a key a newer app added). The list is ordered client side
 * with `sortCustomListTasks` either way; the server order only has to be a valid one.
 */
export function serverSortParams(sortBy: string, orderBy: string): { sort_by?: string; order_by?: string } {
  if (!SERVER_SORT_KEYS.has(sortBy)) return {}
  return { sort_by: sortBy, order_by: orderBy.toLowerCase() === 'desc' ? 'desc' : 'asc' }
}
