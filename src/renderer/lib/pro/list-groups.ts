// How a custom list groups its rows (cross-app semantics 3.8, `group_by`). Pure: the view passes
// the names and the day in. Groups keep the list's own order inside them; an empty group is left out.
import { addLocalDays, isNoDueDate, localDateOf, type LocalDate } from '../../../shared/due-dates'
import type { GroupBy } from '../../../shared/pro/list-conditions'

export interface GroupableTask {
  id: number
  project_id: number
  due_date?: string | null
  start_date?: string | null
  is_favorite?: boolean
  labels?: ReadonlyArray<{ id: number; title: string }> | null
}

export interface ListGroup<T> {
  key: string
  title: string
  /** The project's colour, for project groups. */
  color?: string | null
  tasks: T[]
}

export interface GroupHelpers<T> {
  today: LocalDate
  projectTitle: (projectId: number) => string
  projectColor?: (projectId: number) => string | null | undefined
  /** The task's person: the open promise's person, else the first person label. */
  personOf: (task: T) => { id: number; title: string } | null
}

const DUE_BUCKETS = [
  ['overdue', 'Overdue'],
  ['today', 'Today'],
  ['tomorrow', 'Tomorrow'],
  ['week', 'Next 7 days'],
  ['later', 'Later'],
  ['none', 'No due date'],
] as const

const START_BUCKETS = [
  ['started', 'Started'],
  ['none', 'No start date'],
  ['later', 'Starts later'],
] as const

function dueBucket(value: string | null | undefined, today: LocalDate): string {
  if (isNoDueDate(value)) return 'none'
  const day = localDateOf(value)
  if (day < today) return 'overdue'
  if (day === today) return 'today'
  if (day === addLocalDays(today, 1)) return 'tomorrow'
  if (day <= addLocalDays(today, 7)) return 'week'
  return 'later'
}

function startBucket(value: string | null | undefined, today: LocalDate): string {
  if (isNoDueDate(value)) return 'none'
  return localDateOf(value) <= today ? 'started' : 'later'
}

function byKey<T>(tasks: readonly T[], keyOf: (task: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const task of tasks) {
    const key = keyOf(task)
    const list = groups.get(key)
    if (list) list.push(task)
    else groups.set(key, [task])
  }
  return groups
}

function fixed<T>(groups: Map<string, T[]>, order: ReadonlyArray<readonly [string, string]>): ListGroup<T>[] {
  return order.flatMap(([key, title]) => {
    const tasks = groups.get(key)
    return tasks && tasks.length ? [{ key, title, tasks }] : []
  })
}

/**
 * The groups for `groupBy`, or null for `none`. Project, label and person groups come in the order
 * their first task appears in the list, with "No label" / "No person" last; a task with several
 * labels goes under the first by name. Due, start and flagged groups have a fixed order.
 */
export function groupListTasks<T extends GroupableTask>(tasks: readonly T[], groupBy: GroupBy, helpers: GroupHelpers<T>): ListGroup<T>[] | null {
  switch (groupBy) {
    case 'none':
      return null
    case 'project': {
      const groups = byKey(tasks, (task) => String(task.project_id))
      return [...groups].map(([key, list]) => ({
        key: `project:${key}`,
        title: helpers.projectTitle(Number(key)),
        color: helpers.projectColor?.(Number(key)) ?? null,
        tasks: list,
      }))
    }
    case 'label': {
      const titles = new Map<string, string>()
      const groups = byKey(tasks, (task) => {
        const first = [...(task.labels ?? [])].sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id)[0]
        if (!first) return ''
        titles.set(String(first.id), first.title)
        return String(first.id)
      })
      return withLast(groups, (key) => ({ key: `label:${key}`, title: titles.get(key) ?? '' }), { key: 'label:none', title: 'No label' })
    }
    case 'person': {
      const titles = new Map<string, string>()
      const groups = byKey(tasks, (task) => {
        const person = helpers.personOf(task)
        if (!person) return ''
        titles.set(String(person.id), person.title)
        return String(person.id)
      })
      return withLast(groups, (key) => ({ key: `person:${key}`, title: titles.get(key) ?? '' }), { key: 'person:none', title: 'No person' })
    }
    case 'due':
      return fixed(byKey(tasks, (task) => dueBucket(task.due_date, helpers.today)), DUE_BUCKETS).map((group) => ({ ...group, key: `due:${group.key}` }))
    case 'start':
      return fixed(byKey(tasks, (task) => startBucket(task.start_date, helpers.today)), START_BUCKETS).map((group) => ({ ...group, key: `start:${group.key}` }))
    case 'flagged':
      return fixed(byKey(tasks, (task) => (task.is_favorite === true ? 'yes' : 'no')), [['yes', 'Flagged'], ['no', 'Not flagged']]).map((group) => ({ ...group, key: `flagged:${group.key}` }))
  }
}

function withLast<T>(groups: Map<string, T[]>, named: (key: string) => { key: string; title: string }, none: { key: string; title: string }): ListGroup<T>[] {
  const result: ListGroup<T>[] = []
  for (const [key, list] of groups) if (key !== '') result.push({ ...named(key), tasks: list })
  const rest = groups.get('')
  if (rest?.length) result.push({ ...none, tasks: rest })
  return result
}
