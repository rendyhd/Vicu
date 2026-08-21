import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Task } from '@/lib/vikunja-types'
import {
  mapTaskDoneByIds,
  removeTaskIdsFromTree,
  subtaskProgress,
  taskDescendants,
  unfinishedDescendants,
} from '../task-hierarchy'
import { resolveSelectedTasks } from '../task-selection'

function task(id: number, done = false, children: Task[] = []): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    done,
    done_at: '0001-01-01T00:00:00Z',
    due_date: '0001-01-01T00:00:00Z',
    start_date: '0001-01-01T00:00:00Z',
    end_date: '0001-01-01T00:00:00Z',
    priority: 0,
    project_id: 1,
    labels: [],
    reminders: [],
    related_tasks: children.length > 0 ? { subtask: children } : {},
    created: '',
    updated: '',
    created_by: { id: 1, username: 'owner' },
    identifier: '',
    position: 0,
    bucket_id: 0,
    percent_done: 0,
    repeat_after: 0,
    repeat_mode: 0,
    hex_color: '',
  }
}

describe('task hierarchy', () => {
  it('walks every level and reports recursive progress', () => {
    const root = task(1, false, [task(2, true, [task(3)]), task(4)])

    expect(taskDescendants(root).map((item) => item.id)).toEqual([2, 3, 4])
    expect(unfinishedDescendants(root).map((item) => item.id)).toEqual([3, 4])
    expect(subtaskProgress(root)).toEqual({ completed: 1, total: 3 })
  })

  it('updates embedded copies without changing already-completed siblings', () => {
    const root = task(1, false, [task(2), task(3, true)])
    const updated = mapTaskDoneByIds(root, new Map([[1, true], [2, true]]))

    expect(updated.done).toBe(true)
    expect(updated.related_tasks?.subtask?.map((item) => item.done)).toEqual([true, true])
  })

  it('removes a deleted subtree from embedded relation caches', () => {
    const root = task(1, false, [task(2, false, [task(3)]), task(4)])
    const updated = removeTaskIdsFromTree(root, new Set([2, 3]))

    expect(updated?.related_tasks?.subtask?.map((item) => item.id)).toEqual([4])
  })

  it('resolves an expanded child for keyboard and context-menu actions', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['tasks', 'today'], [task(1, false, [task(2)])])

    expect(resolveSelectedTasks(queryClient, new Set([2])).map((item) => item.id)).toEqual([2])
  })
})
