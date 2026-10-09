import { describe, it, expect } from 'vitest'
import {
  asksForOpenTasksOnly,
  dropReleasedCompletions,
  evictForeignCompletions,
  mergeProjectUndoWindow,
  mergeSectionUndoWindow,
  mergeSmartListUndoWindow,
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

describe('mergeSmartListUndoWindow', () => {
  it('appends a task toggled on this path that the server no longer returns', () => {
    const listed = task(1, false)
    const reopened = task(2, false)
    const completed = store([{ task: reopened, path: '/logbook' }])

    expect(mergeSmartListUndoWindow([listed], completed, '/logbook')).toEqual([listed, reopened])
  })

  it('ignores another path, a nested row and a task the server already returned', () => {
    const list = [task(1, false)]
    const completed = store([
      { task: task(2), path: '/today' },
      { task: task(3), path: '/logbook', suppressTopLevelUndo: true },
      { task: task(1, true), path: '/logbook' },
    ])

    expect(mergeSmartListUndoWindow(list, completed, '/logbook')).toBe(list)
  })

  it('never shows an implementation-detail task', () => {
    const carrier = { ...task(5), description: '<!-- vicu-routine:v1:e30 -->' } as Task
    expect(mergeSmartListUndoWindow([], store([{ task: carrier, path: '/logbook' }]), '/logbook')).toEqual([])
  })

  // A refetch of Today no longer returns a held completion. Appending it moved the row out from
  // under the pointer, which ended the hold (pointerleave) while the user was still on it.
  it('puts a held task back after the row that was above it, not at the end, when a refetch drops it', () => {
    const [a, b, c, d] = [task(1), task(2), task(3), task(4)]
    const held = task(2, true)
    const completed = store([{ task: held, path: '/today' }])
    const previous = [a, held, c, d]

    expect(mergeSmartListUndoWindow([a, c, d], completed, '/today', previous).map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it('keeps a held first row first and skips rows that left the list since', () => {
    const completed = store([
      { task: task(1, true), path: '/today' },
      { task: task(4, true), path: '/today' },
    ])
    const previous = [task(1, true), task(2), task(3), task(4, true), task(5)]

    // Row 3 is gone too: 4 goes after 2, the nearest row above it that is still listed.
    expect(mergeSmartListUndoWindow([task(2), task(5)], completed, '/today', previous).map((t) => t.id)).toEqual([1, 2, 4, 5])
  })

  it('keeps the order of consecutive held rows and appends one the previous list did not have', () => {
    const completed = store([
      { task: task(3, true), path: '/today' },
      { task: task(2, true), path: '/today' },
      { task: task(9, true), path: '/today' },
    ])
    const previous = [task(1), task(2, true), task(3, true), task(4)]

    expect(mergeSmartListUndoWindow([task(1), task(4)], completed, '/today', previous).map((t) => t.id)).toEqual([1, 2, 3, 4, 9])
  })
})

describe('dropReleasedCompletions', () => {
  it('keeps a done row while the hold has it on this path and drops it once the entry is gone', () => {
    const tasks = [task(1, true), task(2, false)]
    expect(dropReleasedCompletions(tasks, store([{ task: task(1, true), path: '/today' }]), '/today')).toBe(tasks)
    expect(dropReleasedCompletions(tasks, new Map(), '/today')).toEqual([task(2, false)])
  })

  it('drops a done row held for another path', () => {
    const tasks = [task(1, true)]
    expect(dropReleasedCompletions(tasks, store([{ task: task(1, true), path: '/anytime' }]), '/today')).toEqual([])
  })

  it('keeps the subtasks a held parent completed along with it', () => {
    const tasks = [task(5, true), task(6, true), task(7, false)]
    const completed = store([{ task: task(5, true), path: '/tag/1', autoCompletedSubtasks: [task(6)] }])
    expect(dropReleasedCompletions(tasks, completed, '/tag/1')).toBe(tasks)
    expect(dropReleasedCompletions(tasks, new Map(), '/tag/1')).toEqual([task(7, false)])
  })

  it('never touches open rows and returns the same array when nothing is dropped', () => {
    const tasks = [task(1, false), task(2, false)]
    expect(dropReleasedCompletions(tasks, new Map(), '/today')).toBe(tasks)
  })
})

describe('asksForOpenTasksOnly', () => {
  it('is true for the open-only filters of the smart lists', () => {
    expect(asksForOpenTasksOnly('done = false')).toBe(true)
    expect(asksForOpenTasksOnly("done = false && due_date != '0001-01-01T00:00:00Z'")).toBe(true)
    expect(asksForOpenTasksOnly('done = false && labels = 4')).toBe(true)
    expect(asksForOpenTasksOnly('project_id = 3 && done=false')).toBe(true)
  })

  it('is false for the Logbook, other filters and no filter', () => {
    expect(asksForOpenTasksOnly('done = true')).toBe(false)
    expect(asksForOpenTasksOnly('project_id = 3')).toBe(false)
    expect(asksForOpenTasksOnly('done = false || done = true')).toBe(false)
    expect(asksForOpenTasksOnly(undefined)).toBe(false)
  })
})
