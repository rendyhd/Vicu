/**
 * How a custom list is ordered, shared by the main window and Quick View and the same as Android
 * (`CustomListFilterBuilder.sortTasks`; both run the same cases). The server's own sort is not
 * relied on: it places tasks without a date differently per database, and `position` has no
 * meaning outside a project view (`GET /tasks?sort_by=position` is a 400).
 *
 * - Sort keys: due_date, created, updated, priority, title, done_at, position. Any other key means
 *   last updated first.
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
  title?: string
  priority?: number
  position?: number
  due_date?: string | null
  created?: string | null
  updated?: string | null
  done_at?: string | null
}

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

/** A sorted copy of `tasks`; the list given is not changed. */
export function sortCustomListTasks<T extends CustomListSortable>(
  tasks: readonly T[],
  sortBy: string,
  orderBy: string,
): T[] {
  const descending = orderBy.toLowerCase() === 'desc'
  let comparator: Comparator<T>
  switch (sortBy) {
    case 'due_date':
      comparator = byDate(descending, (task) => task.due_date)
      break
    case 'created':
      comparator = byDate(descending, (task) => task.created)
      break
    case 'updated':
      comparator = byDate(descending, (task) => task.updated)
      break
    case 'priority':
      comparator = byKey(descending, (task) => task.priority ?? 0)
      break
    case 'title':
      comparator = byKey(descending, (task) => (task.title ?? '').toLowerCase())
      break
    case 'done_at':
      comparator = byDate(descending, (task) => task.done_at)
      break
    case 'position':
      comparator = byKey(descending, (task) => task.position ?? 0)
      break
    default:
      comparator = byDate(true, (task) => task.updated)
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
