import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  insertPendingTask,
  mapTaskInCaches,
  pendingTaskFromCreate,
  remapTempTaskIds,
  taskMayMatchServerFilter,
} from '../pending-cache'
import { NULL_DATE } from '../constants'
import type { Label, Task } from '../vikunja-types'

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    done: false,
    done_at: NULL_DATE,
    due_date: NULL_DATE,
    start_date: NULL_DATE,
    end_date: NULL_DATE,
    priority: 0,
    project_id: 7,
    labels: [],
    reminders: [],
    repeat_after: 0,
    repeat_mode: 0,
    percent_done: 0,
    position: 0,
    bucket_id: 0,
    identifier: '',
    hex_color: '',
    created: '2026-10-01T00:00:00Z',
    updated: '2026-10-01T00:00:00Z',
    created_by: { id: 1, username: 'me' },
    ...overrides,
  }
}

const label = (id: number, title: string): Label => ({ id, title, hex_color: '', created: '', updated: '' })

describe('pendingTaskFromCreate', () => {
  it('builds a task the UI can render from what was queued, with the temp id', () => {
    const created = pendingTaskFromCreate(-3, 7, { title: 'Buy milk', priority: 2, due_date: '2026-10-08T21:59:59Z' }, {
      now: '2026-10-07T10:00:00.000Z',
      labels: [label(4, 'home')],
    })

    expect(created).toMatchObject({
      id: -3,
      title: 'Buy milk',
      project_id: 7,
      priority: 2,
      due_date: '2026-10-08T21:59:59Z',
      done: false,
      labels: [{ id: 4, title: 'home' }],
      created: '2026-10-07T10:00:00.000Z',
    })
    expect(created.start_date).toBe(NULL_DATE)
  })

  it('marks a task created already completed', () => {
    expect(pendingTaskFromCreate(-4, 7, { title: 'Done already' }, { done: true }).done).toBe(true)
  })
})

describe('taskMayMatchServerFilter', () => {
  const open = task(-1)

  it('accepts an open task for open-task filters and rejects it for the completed list', () => {
    expect(taskMayMatchServerFilter(open, 'done = false')).toBe(true)
    expect(taskMayMatchServerFilter(open, 'done = true')).toBe(false)
  })

  it('applies the project clause of the Inbox and Project views', () => {
    expect(taskMayMatchServerFilter(open, 'done = false && project_id = 7')).toBe(true)
    expect(taskMayMatchServerFilter(open, 'done = false && project_id = 9')).toBe(false)
  })

  it('needs a due date for the Today and Upcoming filter', () => {
    const filter = `done = false && due_date != '${NULL_DATE}'`
    expect(taskMayMatchServerFilter(open, filter)).toBe(false)
    expect(taskMayMatchServerFilter(task(-2, { due_date: '2026-10-08T10:00:00Z' }), filter)).toBe(true)
  })

  it('accepts a task for a filter it does not understand (the view filters exactly afterwards)', () => {
    expect(taskMayMatchServerFilter(open, '(project_id = 1 || project_id = 2) && done = false')).toBe(true)
    expect(taskMayMatchServerFilter(open, undefined)).toBe(true)
  })
})

describe('insertPendingTask', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient()
  })

  it('adds the task to the project view, the matching task lists and the section cache, but not to searches or the logbook', () => {
    qc.setQueryData(['view-tasks', 7, 70], [task(1)])
    qc.setQueryData(['view-tasks', 9, 90], [task(2, { project_id: 9 })])
    qc.setQueryData(['tasks', { filter: 'done = false && project_id = 7' }], [task(1)])
    qc.setQueryData(['tasks', { filter: 'done = false && project_id = 9' }], [task(2, { project_id: 9 })])
    qc.setQueryData(['tasks', { filter: 'done = true' }], [task(3, { done: true })])
    qc.setQueryData(['tasks', 'search', 'milk'], [])
    qc.setQueryData(['section-tasks', 5, [7, 9]], [
      { id: 7, tasks: [task(1)], viewId: 70 },
      { id: 9, tasks: [], viewId: 90 },
    ])

    insertPendingTask(qc, task(-1, { title: 'Pending' }))

    expect((qc.getQueryData(['view-tasks', 7, 70]) as Task[]).map((t) => t.id)).toContain(-1)
    expect((qc.getQueryData(['view-tasks', 9, 90]) as Task[]).map((t) => t.id)).not.toContain(-1)
    expect((qc.getQueryData(['tasks', { filter: 'done = false && project_id = 7' }]) as Task[]).map((t) => t.id)).toContain(-1)
    expect((qc.getQueryData(['tasks', { filter: 'done = false && project_id = 9' }]) as Task[]).map((t) => t.id)).not.toContain(-1)
    expect((qc.getQueryData(['tasks', { filter: 'done = true' }]) as Task[]).map((t) => t.id)).not.toContain(-1)
    expect(qc.getQueryData(['tasks', 'search', 'milk'])).toEqual([])
    const sections = qc.getQueryData(['section-tasks', 5, [7, 9]]) as Array<{ id: number; tasks: Task[] }>
    expect(sections[0].tasks.map((t) => t.id)).toContain(-1)
    expect(sections[1].tasks).toHaveLength(0)
  })

  it('does not add a task twice', () => {
    qc.setQueryData(['view-tasks', 7, 70], [task(-1)])
    insertPendingTask(qc, task(-1))
    expect(qc.getQueryData(['view-tasks', 7, 70])).toHaveLength(1)
  })
})

describe('remapTempTaskIds (replay created the tasks on the server)', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient()
  })

  it('swaps temp ids for real ids in every cached task list, keeping what the user typed', () => {
    qc.setQueryData(['tasks', { filter: 'done = false' }], [task(-3, { title: 'Offline task' }), task(5)])
    qc.setQueryData(['view-tasks', 7, 70], [task(-3, { title: 'Offline task' })])
    qc.setQueryData(['section-tasks', 5, [7]], [{ id: 7, tasks: [task(-3)], viewId: 70 }])

    remapTempTaskIds(qc, { '-3': 812 })

    const list = qc.getQueryData(['tasks', { filter: 'done = false' }]) as Task[]
    expect(list.map((t) => t.id)).toEqual([812, 5])
    expect(list[0].title).toBe('Offline task')
    expect((qc.getQueryData(['view-tasks', 7, 70]) as Task[])[0].id).toBe(812)
    expect((qc.getQueryData(['section-tasks', 5, [7]]) as Array<{ tasks: Task[] }>)[0].tasks[0].id).toBe(812)
  })

  it('remaps nested subtask copies and drops fetched detail of the temp id', () => {
    const parent = task(5, { related_tasks: { subtask: [task(-3)] } })
    qc.setQueryData(['tasks', {}], [parent])
    qc.setQueryData(['task-detail', -3], [])

    remapTempTaskIds(qc, { '-3': 812 })

    expect(((qc.getQueryData(['tasks', {}]) as Task[])[0].related_tasks?.subtask ?? [])[0].id).toBe(812)
    expect(qc.getQueryData(['task-detail', -3])).toBeUndefined()
  })

  it('does nothing for an empty map and leaves unrelated tasks alone', () => {
    const original = [task(5)]
    qc.setQueryData(['tasks', {}], original)
    remapTempTaskIds(qc, {})
    expect(qc.getQueryData(['tasks', {}])).toBe(original)
    remapTempTaskIds(qc, { '-9': 99 })
    expect(qc.getQueryData(['tasks', {}])).toBe(original)
  })
})

describe('mapTaskInCaches', () => {
  it('applies a change to the task wherever it is cached', () => {
    const qc = new QueryClient()
    qc.setQueryData(['tasks', {}], [task(5), task(6)])
    qc.setQueryData(['view-tasks', 7, 70], [task(5)])
    qc.setQueryData(['section-tasks', 1, [7]], [{ id: 7, tasks: [task(5)], viewId: 70 }])

    mapTaskInCaches(qc, 5, (t) => ({ ...t, labels: [label(1, 'x')] }))

    expect((qc.getQueryData(['tasks', {}]) as Task[])[0].labels).toHaveLength(1)
    expect((qc.getQueryData(['tasks', {}]) as Task[])[1].labels).toHaveLength(0)
    expect((qc.getQueryData(['view-tasks', 7, 70]) as Task[])[0].labels).toHaveLength(1)
    expect((qc.getQueryData(['section-tasks', 1, [7]]) as Array<{ tasks: Task[] }>)[0].tasks[0].labels).toHaveLength(1)
  })
})
