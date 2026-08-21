import { describe, it, expect } from 'vitest'
import {
  evictForeignCompletions,
  mergeProjectUndoWindow,
  mergeSectionUndoWindow,
} from '../undo-window'
import type { Task } from '../vikunja-types'
import type { CompletedTaskEntry } from '@/stores/completed-tasks-store'

function task(id: number, done = false, project_id?: number): Task {
  return { id, done, project_id } as Task
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

  // The persistent leak: after the user completes a subproject task and
  // navigates to the parent, AppShell CLEARS the completed-tasks store — but the
  // optimistic done:true still sits in the parent's section-tasks cache. With no
  // store entry left, the task must STILL be dropped: these views only ever
  // query done = false, so a done task is always a leak, never a real row. The
  // old logic kept it (no entry → keep) and leaned on a refetch to clean up,
  // which leaves it visible until restart when the refetch doesn't win.
  it('drops a leaked done:true task with no store entry (store cleared on navigation)', () => {
    const tasks = [task(1, true), task(2, false)]
    expect(evictForeignCompletions(tasks, new Map(), '/project/2')).toEqual([task(2, false)])
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

  it('keeps active tasks that are not in the completed store', () => {
    const tasks = [task(1, false), task(2, false)]
    const completed = store([{ task: task(3, true), path: '/project/5' }])
    expect(evictForeignCompletions(tasks, completed, '/project/2')).toEqual([
      task(1, false),
      task(2, false),
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

describe('mergeSectionUndoWindow', () => {
  const section = (projectId: number, tasks: Task[]) => ({
    project: { id: projectId },
    tasks,
    viewId: projectId,
  })

  // The user-reported bug, at the section delivery point: after navigating to
  // the parent the store is empty, but the subproject completion's done:true
  // still sits in this section's cache. It must be dropped even with no entry,
  // not left until a refetch wins.
  it('drops a leaked done:true row from a section when the store is empty', () => {
    const sections = [section(5, [task(1, true), task(2, false)])]
    const merged = mergeSectionUndoWindow(sections, new Map(), '/project/2')
    expect(merged[0].tasks).toEqual([task(2, false)])
  })

  it('re-adds a same-path completion as the section undo window', () => {
    // Completed in the parent view (path /project/2); the server (done = false)
    // no longer returns it, so it must be merged back to linger struck-through.
    const done = task(1, true, 5)
    const sections = [section(5, [task(2, false, 5)])]
    const completed = store([{ task: done, path: '/project/2' }])
    const merged = mergeSectionUndoWindow(sections, completed, '/project/2')
    expect(merged[0].tasks.map((t) => t.id)).toContain(1)
  })

  it('returns the original sections reference when nothing changes', () => {
    const sections = [section(5, [task(1, false)])]
    expect(mergeSectionUndoWindow(sections, new Map(), '/project/2')).toBe(sections)
  })
})

describe('mergeProjectUndoWindow', () => {
  it('does not promote a completed inline subtask into the project root list', () => {
    const projectId = 2
    const nestedCompletion = task(1, true, projectId)
    const completed = store([{
      task: nestedCompletion,
      path: '/project/2',
      suppressTopLevelUndo: true,
    }])

    expect(mergeProjectUndoWindow([], completed, '/project/2', projectId)).toEqual([])
  })

  it('does not add a same-path child project completion to the parent top list', () => {
    const parentProjectId = 2
    const childProjectId = 5
    const childCompletion = task(1, true, childProjectId)
    const parentTask = task(2, false, parentProjectId)
    const completed = store([{ task: childCompletion, path: '/project/2' }])

    expect(
      mergeProjectUndoWindow([parentTask], completed, '/project/2', parentProjectId)
    ).toEqual([parentTask])
  })
})
