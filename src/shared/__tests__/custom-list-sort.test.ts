import { describe, expect, it } from 'vitest'
import { serverSortParams, sortCustomListTasks } from '../custom-list-sort'

// The same cases as Android's CustomListSortTest (CustomListFilterBuilder.sortTasks): both apps
// order a custom list the same way.

const NO_DATE = '0001-01-01T00:00:00Z'

interface T {
  id: number
  title?: string
  priority?: number
  position?: number
  due_date?: string
  created?: string
  updated?: string
  done_at?: string
}

const ids = (tasks: T[]) => tasks.map((task) => task.id)

describe('sortCustomListTasks', () => {
  it('due_date asc puts tasks without a date last', () => {
    const tasks: T[] = [
      { id: 1, due_date: NO_DATE },
      { id: 2, due_date: '2026-06-12T00:00:00Z' },
      { id: 3, due_date: '2026-06-10T00:00:00Z' },
    ]
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'asc'))).toEqual([3, 2, 1])
  })

  it('due_date desc puts the latest first and tasks without a date still last', () => {
    const tasks: T[] = [
      { id: 1, due_date: NO_DATE },
      { id: 2, due_date: '2026-06-12T00:00:00Z' },
      { id: 3, due_date: '2026-06-10T00:00:00Z' },
      { id: 4, due_date: '' },
    ]
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'desc'))).toEqual([2, 3, 1, 4])
  })

  it('treats a missing, null or unreadable date as no date', () => {
    const tasks: T[] = [
      { id: 1 },
      { id: 2, due_date: 'not a date' },
      { id: 3, due_date: '2026-06-10T00:00:00Z' },
      { id: 4, due_date: null as unknown as string },
    ]
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'asc'))).toEqual([3, 1, 2, 4])
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'desc'))).toEqual([3, 1, 2, 4])
  })

  it('compares dates as instants, not as strings', () => {
    const tasks: T[] = [
      { id: 1, due_date: '2026-06-10T22:00:00.500Z' },
      { id: 2, due_date: '2026-06-10T22:00:00Z' },
      { id: 3, due_date: '2026-06-10T23:59:59+01:00' },
    ]
    // 22:00:00Z, 22:00:00.5Z, 22:59:59Z
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'asc'))).toEqual([2, 1, 3])
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'desc'))).toEqual([3, 1, 2])
  })

  it('done_at puts tasks that are not done last in both directions', () => {
    const tasks: T[] = [
      { id: 1, done_at: NO_DATE },
      { id: 2, done_at: '2026-06-12T08:00:00Z' },
      { id: 3, done_at: '2026-06-10T08:00:00Z' },
    ]
    expect(ids(sortCustomListTasks(tasks, 'done_at', 'asc'))).toEqual([3, 2, 1])
    expect(ids(sortCustomListTasks(tasks, 'done_at', 'desc'))).toEqual([2, 3, 1])
  })

  it('sorts created and updated the same way', () => {
    const tasks: T[] = [
      { id: 1, created: '2026-01-02T00:00:00Z', updated: '2026-03-01T00:00:00Z' },
      { id: 2, created: '2026-01-01T00:00:00Z', updated: '2026-04-01T00:00:00Z' },
      { id: 3, created: NO_DATE, updated: '' },
    ]
    expect(ids(sortCustomListTasks(tasks, 'created', 'asc'))).toEqual([2, 1, 3])
    expect(ids(sortCustomListTasks(tasks, 'created', 'desc'))).toEqual([1, 2, 3])
    expect(ids(sortCustomListTasks(tasks, 'updated', 'asc'))).toEqual([1, 2, 3])
    expect(ids(sortCustomListTasks(tasks, 'updated', 'desc'))).toEqual([2, 1, 3])
  })

  it('position sorts both ways', () => {
    const tasks: T[] = [{ id: 1, position: 30 }, { id: 2, position: 10 }, { id: 3, position: 20 }]
    expect(ids(sortCustomListTasks(tasks, 'position', 'asc'))).toEqual([2, 3, 1])
    expect(ids(sortCustomListTasks(tasks, 'position', 'desc'))).toEqual([1, 3, 2])
  })

  it('title is case-insensitive', () => {
    const tasks: T[] = [{ id: 1, title: 'banana' }, { id: 2, title: 'Apple' }, { id: 3, title: 'cherry' }]
    expect(ids(sortCustomListTasks(tasks, 'title', 'asc'))).toEqual([2, 1, 3])
    expect(ids(sortCustomListTasks(tasks, 'title', 'desc'))).toEqual([3, 1, 2])
  })

  it('equal keys keep their order in both directions', () => {
    const tasks: T[] = [{ id: 1, priority: 2 }, { id: 2, priority: 2 }, { id: 3, priority: 4 }]
    expect(ids(sortCustomListTasks(tasks, 'priority', 'asc'))).toEqual([1, 2, 3])
    expect(ids(sortCustomListTasks(tasks, 'priority', 'desc'))).toEqual([3, 1, 2])
  })

  it('tasks with equal dates, and tasks without one, keep their order in both directions', () => {
    const tasks: T[] = [
      { id: 1, due_date: NO_DATE },
      { id: 2, due_date: '2026-06-10T00:00:00Z' },
      { id: 3, due_date: NO_DATE },
      { id: 4, due_date: '2026-06-10T00:00:00Z' },
    ]
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'asc'))).toEqual([2, 4, 1, 3])
    expect(ids(sortCustomListTasks(tasks, 'due_date', 'desc'))).toEqual([2, 4, 1, 3])
  })

  it('priority desc puts urgent first', () => {
    const tasks: T[] = [{ id: 1, priority: 1 }, { id: 2, priority: 4 }, { id: 3, priority: 0 }]
    expect(ids(sortCustomListTasks(tasks, 'priority', 'desc'))).toEqual([2, 1, 3])
  })

  it('reads the order case-insensitively and treats anything but desc as ascending', () => {
    const tasks: T[] = [{ id: 1, priority: 1 }, { id: 2, priority: 4 }]
    expect(ids(sortCustomListTasks(tasks, 'priority', 'DESC'))).toEqual([2, 1])
    expect(ids(sortCustomListTasks(tasks, 'priority', 'sideways'))).toEqual([1, 2])
  })

  it('orders by last update, newest first, for a sort key it does not know', () => {
    const tasks: T[] = [
      { id: 1, updated: '2026-03-01T00:00:00Z' },
      { id: 2, updated: '2026-04-01T00:00:00Z' },
      { id: 3, updated: NO_DATE },
    ]
    expect(ids(sortCustomListTasks(tasks, 'from_the_future', 'asc'))).toEqual([2, 1, 3])
  })

  it('does not change the list it is given', () => {
    const tasks: T[] = [{ id: 2, priority: 2 }, { id: 1, priority: 1 }]
    const copy = [...tasks]
    const sorted = sortCustomListTasks(tasks, 'priority', 'asc')
    expect(tasks).toEqual(copy)
    expect(sorted).not.toBe(tasks)
  })
})

describe('serverSortParams', () => {
  it('passes on the sorts the tasks endpoint accepts', () => {
    expect(serverSortParams('due_date', 'asc')).toEqual({ sort_by: 'due_date', order_by: 'asc' })
    expect(serverSortParams('done_at', 'desc')).toEqual({ sort_by: 'done_at', order_by: 'desc' })
    expect(serverSortParams('title', 'ASC')).toEqual({ sort_by: 'title', order_by: 'asc' })
  })

  it('sends none for position (a 400 outside a project view) or for a key from a newer app', () => {
    expect(serverSortParams('position', 'asc')).toEqual({})
    expect(serverSortParams('start_date', 'asc')).toEqual({})
    expect(serverSortParams('', 'asc')).toEqual({})
  })

  it('reads any order but desc as ascending', () => {
    expect(serverSortParams('priority', 'weird')).toEqual({ sort_by: 'priority', order_by: 'asc' })
  })
})
