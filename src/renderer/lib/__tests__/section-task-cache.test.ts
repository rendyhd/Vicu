import { describe, expect, it } from 'vitest'
import {
  updateSectionTaskCache,
  type SectionTaskCacheEntry,
} from '../section-task-cache'
import type { Task } from '../vikunja-types'

function task(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: 'Task',
    description: '',
    done: false,
    due_date: '0001-01-01T00:00:00Z',
    priority: 0,
    project_id: 10,
    labels: [],
    reminders: [],
    repeat_after: 0,
    repeat_mode: 0,
    percent_done: 0,
    position: 0,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function entry(id: number, tasks: Task[] = []): SectionTaskCacheEntry {
  return { id, tasks, viewId: id * 10 }
}

describe('updateSectionTaskCache', () => {
  it('leaves descendant entries alone when updating a parent-project task', () => {
    const entries = [entry(20), entry(30)]
    const parentTask = task({ id: 5, project_id: 10 })

    expect(() =>
      updateSectionTaskCache(entries, parentTask.id, {
        ...parentTask,
        description: '<p>Saved notes</p>',
      })
    ).not.toThrow()
    expect(updateSectionTaskCache(entries, parentTask.id, parentTask)).toBe(entries)
  })

  it('updates notes and priority for a task in a descendant project', () => {
    const childTask = task({ id: 6, project_id: 20 })
    const entries = [entry(20, [childTask]), entry(30)]

    const updated = updateSectionTaskCache(entries, childTask.id, {
      description: '<p>Saved notes</p>',
      priority: 3,
    })

    expect(updated?.[0].tasks[0]).toMatchObject({
      id: childTask.id,
      description: '<p>Saved notes</p>',
      priority: 3,
      project_id: 20,
    })
  })

  it('moves a task between flat descendant-project entries', () => {
    const childTask = task({ id: 7, project_id: 20 })
    const entries = [entry(20, [childTask]), entry(30)]

    const updated = updateSectionTaskCache(entries, childTask.id, {
      ...childTask,
      project_id: 30,
    })

    expect(updated?.[0].tasks).toEqual([])
    expect(updated?.[1].tasks).toContainEqual(expect.objectContaining({
      id: childTask.id,
      project_id: 30,
    }))
  })
})
