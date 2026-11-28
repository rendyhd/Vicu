/**
 * The filters of a search (docs/cross-app-semantics-v1.md, section 17). They last for one search:
 * nothing here is saved or synced. The date windows are the custom lists' (3.1) without overdue
 * tasks. Android implements the same contract and both apps run `searchFilters` from
 * test-fixtures/cross-app-semantics-v1.json against it.
 */
import { buildCustomListServerFilter, inDateWindow, type CustomListTask } from './custom-list-filter'
import { addLocalDays, localDateOf, startOfLocalDay, toLocalDate, type LocalDate } from './due-dates'
import { getWeekStart, type WeekStart } from './week-start'

export type SearchDate = 'all' | 'overdue' | 'today' | 'this_week' | 'this_month' | 'no_due_date' | 'range'
export type SearchStatus = 'all' | 'open' | 'done'

export interface SearchFilters {
  date?: SearchDate
  /** With `date: 'range'`, local dates; either way round. */
  from?: LocalDate
  to?: LocalDate
  status?: SearchStatus
  label_ids?: number[]
  priorities?: number[]
}

export function searchFiltersActive(filters: SearchFilters): boolean {
  return (filters.date ?? 'all') !== 'all'
    || (filters.status ?? 'all') !== 'all'
    || (filters.label_ids?.length ?? 0) > 0
    || (filters.priorities?.length ?? 0) > 0
}

/** The range's days in order, whichever way round they were picked. */
function rangeOf(filters: SearchFilters): { first: LocalDate; last: LocalDate } | null {
  if (!filters.from || !filters.to) return null
  return filters.from <= filters.to ? { first: filters.from, last: filters.to } : { first: filters.to, last: filters.from }
}

export function matchesSearchFilters(
  task: CustomListTask,
  filters: SearchFilters,
  today: LocalDate | Date = new Date(),
  weekStart: WeekStart = getWeekStart(),
): boolean {
  const day = typeof today === 'string' ? today : toLocalDate(today)
  const status = filters.status ?? 'all'
  if (status === 'open' && task.done) return false
  if (status === 'done' && !task.done) return false

  const due = localDateOf(task.due_date)
  if (filters.date === 'range') {
    const range = rangeOf(filters)
    if (!range || due === '' || due < range.first || due > range.last) return false
  } else if (!inDateWindow(due, filters.date ?? 'all', false, day, weekStart)) {
    return false
  }

  const labels = filters.label_ids ?? []
  if (labels.length > 0 && !(task.labels ?? []).some((label) => labels.includes(label.id))) return false
  const priorities = filters.priorities ?? []
  return priorities.length === 0 || priorities.includes(task.priority ?? 0)
}

/**
 * The server filter: a superset of what `matchesSearchFilters` accepts. With no text to narrow the
 * read, labels and priority go along, so it does not read every task there is.
 */
export function buildSearchServerFilter(filters: SearchFilters, hasText: boolean, now: Date = new Date()): string | undefined {
  const parts: string[] = []
  if (filters.status === 'open') parts.push('done = false')
  if (filters.status === 'done') parts.push('done = true')
  if (filters.date === 'range') {
    const range = rangeOf(filters)
    if (range) {
      parts.push(`due_date >= '${startOfLocalDay(range.first).toISOString()}'`)
      parts.push(`due_date < '${startOfLocalDay(addLocalDays(range.last, 1)).toISOString()}'`)
    }
  } else {
    const window = buildCustomListServerFilter({ due_date_filter: filters.date ?? 'all', include_overdue: false, include_done: true }, now)
    if (window) parts.push(window)
  }
  if (!hasText) {
    const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',')
    if (filters.label_ids?.length) parts.push(`labels in ${sorted(filters.label_ids)}`)
    if (filters.priorities?.length) parts.push(`priority in ${sorted(filters.priorities)}`)
  }
  return parts.length > 0 ? parts.join(' && ') : undefined
}
