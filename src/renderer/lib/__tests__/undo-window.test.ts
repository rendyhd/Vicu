import { describe, it, expect } from 'vitest'
import { evictForeignCompletions } from '../undo-window'
import type { Task } from '../vikunja-types'
import type { CompletedTaskEntry } from '@/stores/completed-tasks-store'

function task(id: number, done = false): Task {
  return { id, done } as Task
}

function store(entries: CompletedTaskEntry[]): Map<number, CompletedTaskEntry> {
  return new Map(entries.map((e) => [e.task.id, e]))
}

describe('evictForeignCompletions', () => {
  // The reported bug: completing a task in a subproject left it showing as
  // completed in BOTH the parent project's section view AND the subproject's
  // own view. The optimistic update marks done:true in every cached list; the
  // completed-tasks store records the single path whose undo window should keep
  // it visible. On any other path the done task is a leaked optimistic write.
  it('drops a task completed on a different path (the leak)', () => {
    const tasks = [task(1, true), task(2, false)]
    const completed = store([{ task: task(1, true), path: '/project/5' }])
    // Viewing the PARENT project page; the subproject completion leaked in.
    expect(evictForeignCompletions(tasks, completed, '/project/2')).toEqual([task(2, false)])
  })

  it('keeps a task completed on the current path (its undo window)', () => {
    const tasks = [task(1, true), task(2, false)]
    const completed = store([{ task: task(1, true), path: '/project/5' }])
    expect(evictForeignCompletions(tasks, completed, '/project/5')).toEqual([
      task(1, true),
      task(2, false),
    ])
  })

  it('keeps a done:false store entry — an uncompleted task is active again', () => {
    const tasks = [task(1, false)]
    const completed = store([{ task: task(1, false), path: '/logbook' }])
    expect(evictForeignCompletions(tasks, completed, '/project/2')).toEqual([task(1, false)])
  })

  it('keeps tasks that are not in the completed store', () => {
    const tasks = [task(1, false), task(2, true)]
    const completed = store([{ task: task(3, true), path: '/project/5' }])
    expect(evictForeignCompletions(tasks, completed, '/project/2')).toEqual([
      task(1, false),
      task(2, true),
    ])
  })

  it('returns the same array reference when the store is empty', () => {
    const tasks = [task(1, false)]
    expect(evictForeignCompletions(tasks, new Map(), '/project/2')).toBe(tasks)
  })

  it('returns the same array reference when nothing is evicted', () => {
    const tasks = [task(1, true)]
    const completed = store([{ task: task(1, true), path: '/project/2' }])
    // Same path → kept → no new array allocated.
    expect(evictForeignCompletions(tasks, completed, '/project/2')).toBe(tasks)
  })
})
