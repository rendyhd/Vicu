import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  completeTaskRequest,
  uncompleteTaskRequest,
  updateProjectRequest,
  updateTaskRequest,
} from '../use-task-mutations'
import { PROJECT_WRITABLE_FIELDS } from '@/lib/merge-patches'
import { NULL_DATE } from '@/lib/constants'
import { useOfflineStore } from '@/stores/offline-store'
import type { Project, Task } from '@/lib/vikunja-types'

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '<p>notes</p>',
    done: false,
    done_at: NULL_DATE,
    due_date: '2026-10-10T00:00:00Z',
    start_date: NULL_DATE,
    end_date: NULL_DATE,
    priority: 1,
    project_id: 7,
    labels: [{ id: 3, title: 'home', hex_color: '', created: '', updated: '' }],
    reminders: [{ reminder: '2026-10-09T08:00:00Z', relative_period: 0 }],
    repeat_after: 0,
    repeat_mode: 0,
    percent_done: 0,
    position: 10,
    bucket_id: 0,
    identifier: '',
    hex_color: '',
    created: '2026-10-01T00:00:00Z',
    updated: '2026-10-01T00:00:00Z',
    created_by: { id: 1, username: 'me' },
    ...overrides,
  }
}

function project(id: number, overrides: Partial<Project> = {}): Project {
  return {
    id,
    title: `Project ${id}`,
    description: 'About the project',
    parent_project_id: 4,
    is_archived: false,
    hex_color: '3498db',
    position: 1024,
    created: '2026-10-01T00:00:00Z',
    updated: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

const ok = (data: unknown = {}) => ({ success: true as const, data })
let updateTask: ReturnType<typeof vi.fn>
let updateProject: ReturnType<typeof vi.fn>
/** What was asked of `updateTask`, without the options (`{ queue: true, title }`) every main-window write carries. */
const patchCalls = () => updateTask.mock.calls.map(([id, patch]) => [id, patch])

beforeEach(() => {
  updateTask = vi.fn(async () => ok())
  updateProject = vi.fn(async () => ok())
  vi.stubGlobal('window', { api: { updateTask, updateProject } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateTaskRequest', () => {
  it('sends only the changed field, not the whole cached task', async () => {
    const original = task(1)

    await updateTaskRequest({ id: 1, changes: { priority: 3 }, original })

    expect(updateTask).toHaveBeenCalledTimes(1)
    expect(updateTask).toHaveBeenCalledWith(1, { priority: 3 }, expect.objectContaining({ queue: true }))
  })

  it('does not revert fields another client changed: a full spread diffs down to the change', async () => {
    const original = task(1)

    await updateTaskRequest({ id: 1, changes: { ...original, due_date: '2026-10-12T00:00:00.000Z' }, original })

    expect(updateTask).toHaveBeenCalledWith(1, { due_date: '2026-10-12T00:00:00.000Z' }, expect.objectContaining({ queue: true }))
  })

  it('sends a project move as just project_id and never the position', async () => {
    const original = task(1)

    await updateTaskRequest({ id: 1, changes: { project_id: 9, position: 4096 }, original })

    expect(updateTask).toHaveBeenCalledWith(1, { project_id: 9 }, expect.objectContaining({ queue: true }))
  })

  it('sends a recurrence change as both halves and nothing else', async () => {
    await updateTaskRequest({ id: 1, changes: { repeat_after: 604_800, repeat_mode: 0 }, original: task(1) })

    expect(updateTask).toHaveBeenCalledWith(1, { repeat_after: 604_800, repeat_mode: 0 }, expect.objectContaining({ queue: true }))
  })

  it('sends a reminder change without blank reminder fields', async () => {
    await updateTaskRequest({
      id: 1,
      changes: { reminders: [{ reminder: '', relative_period: -900, relative_to: 'due_date' }] },
      original: task(1),
    })

    expect(updateTask).toHaveBeenCalledWith(
      1,
      { reminders: [{ relative_period: -900, relative_to: 'due_date' }] },
      expect.objectContaining({ queue: true }),
    )
  })

  it('clears a due date with null', async () => {
    await updateTaskRequest({ id: 1, changes: { due_date: NULL_DATE }, original: task(1) })

    expect(updateTask).toHaveBeenCalledWith(1, { due_date: null }, expect.objectContaining({ queue: true }))
  })

  it('skips the request when nothing differs', async () => {
    const original = task(1, { due_date: NULL_DATE })

    const result = await updateTaskRequest({ id: 1, changes: { due_date: NULL_DATE, priority: 1 }, original })

    expect(updateTask).not.toHaveBeenCalled()
    expect(result).toBe(original)
  })

  it('sends an explicit change as is when there is no cached original', async () => {
    await updateTaskRequest({ id: 5, changes: { description: '<p>patched</p>' } })

    expect(updateTask).toHaveBeenCalledWith(5, { description: '<p>patched</p>' }, expect.objectContaining({ queue: true }))
  })

  it('throws the server error', async () => {
    updateTask.mockResolvedValueOnce({ success: false, error: 'boom' })

    await expect(updateTaskRequest({ id: 1, changes: { priority: 2 }, original: task(1) }))
      .rejects.toThrow('boom')
  })
})

describe('completeTaskRequest', () => {
  it('sends only done for the parent and each unfinished subtask', async () => {
    // Embedded relation copies can be partial and carry nulls; they must never be patch sources.
    const child1 = { id: 11, title: 'Child 1', done: false, description: null, due_date: null } as unknown as Task
    const child2 = { id: 12, title: 'Child 2', done: false, description: null } as unknown as Task
    const doneChild = { id: 13, title: 'Done child', done: true } as unknown as Task
    const parent = task(10, { related_tasks: { subtask: [child1, child2, doneChild] } })

    await completeTaskRequest(parent)

    expect(patchCalls()).toEqual([
      [12, { done: true }],
      [11, { done: true }],
      [10, { done: true }],
    ])
  })

  it('rolls completed subtasks back with just done when the parent fails', async () => {
    const child = { id: 11, title: 'Child', done: false } as unknown as Task
    const parent = task(10, { related_tasks: { subtask: [child] } })
    updateTask.mockResolvedValueOnce(ok()).mockResolvedValueOnce({ success: false, error: 'nope' })

    await expect(completeTaskRequest(parent)).rejects.toThrow('nope')

    expect(patchCalls()).toEqual([
      [11, { done: true }],
      [10, { done: true }],
      [11, { done: false }],
    ])
  })
})

describe('uncompleteTaskRequest', () => {
  it('sends only done=false for the task and the subtasks it auto-completed', async () => {
    const child = { id: 11, title: 'Child', done: true, description: null } as unknown as Task

    await uncompleteTaskRequest(task(10, { done: true }), [child])

    expect(patchCalls()).toEqual([
      [11, { done: false }],
      [10, { done: false }],
    ])
  })

  it('re-completes restored subtasks with just done when the parent fails', async () => {
    const child = { id: 11, title: 'Child', done: true } as unknown as Task
    updateTask.mockResolvedValueOnce(ok()).mockResolvedValueOnce({ success: false, error: 'nope' })

    await expect(uncompleteTaskRequest(task(10, { done: true }), [child])).rejects.toThrow('nope')

    expect(patchCalls()).toEqual([
      [11, { done: false }],
      [10, { done: false }],
      [11, { done: true }],
    ])
  })
})

describe('undoing the completion of a repeating task', () => {
  const BEFORE = '2026-10-10T09:00:00Z'
  const AFTER = '2026-10-17T09:00:00Z'
  const repeating = (id: number, overrides: Partial<Task> = {}) =>
    task(id, { due_date: BEFORE, repeat_after: 604_800, reminders: [{ reminder: '2026-10-10T08:00:00Z' }], ...overrides })
  /** What the server answers to the completion: open again, a week on. */
  const advanced = (id: number, overrides: Partial<Task> = {}) =>
    task(id, { due_date: AFTER, repeat_after: 604_800, reminders: [{ reminder: '2026-10-17T08:00:00Z' }], ...overrides })
  let fetchTaskById: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchTaskById = vi.fn(async (id: number) => ok(advanced(id)))
    vi.stubGlobal('window', { api: { updateTask, updateProject, fetchTaskById } })
    useOfflineStore.setState({ counts: { pending: 0, failed: 0 } })
  })

  it('puts the dates and reminders back with a merge patch, not a done flag the task already has', async () => {
    const before = repeating(10)
    updateTask.mockResolvedValueOnce(ok(advanced(10)))

    await completeTaskRequest(before)
    updateTask.mockClear()
    await uncompleteTaskRequest(before, [])

    expect(fetchTaskById).toHaveBeenCalledWith(10)
    expect(patchCalls()).toEqual([[10, { due_date: BEFORE, reminders: [{ reminder: '2026-10-10T08:00:00Z' }] }]])
  })

  it('leaves a task alone that the user edited since the completion', async () => {
    const before = repeating(10)
    updateTask.mockResolvedValueOnce(ok(advanced(10)))
    await completeTaskRequest(before)
    updateTask.mockClear()
    fetchTaskById.mockResolvedValueOnce(ok(advanced(10, { due_date: '2026-10-20T09:00:00Z' })))

    await uncompleteTaskRequest(before, [])

    expect(updateTask).not.toHaveBeenCalled()
  })

  it('also reopens a task that is somehow still done', async () => {
    const before = repeating(10)
    updateTask.mockResolvedValueOnce(ok(advanced(10)))
    await completeTaskRequest(before)
    updateTask.mockClear()
    fetchTaskById.mockResolvedValueOnce(ok(advanced(10, { done: true })))

    await uncompleteTaskRequest(before, [])

    expect(patchCalls()).toEqual([[10, { due_date: BEFORE, reminders: [{ reminder: '2026-10-10T08:00:00Z' }], done: false }]])
  })

  it('restores each task of a bulk completion, and only once', async () => {
    const [a, b] = [repeating(10), repeating(11)]
    updateTask.mockResolvedValueOnce(ok(advanced(10))).mockResolvedValueOnce(ok(advanced(11)))
    await completeTaskRequest(a)
    await completeTaskRequest(b)
    updateTask.mockClear()

    await uncompleteTaskRequest(a, [])
    await uncompleteTaskRequest(b, [])
    expect(patchCalls().map(([id]) => id)).toEqual([10, 11])

    // The snapshot was used up: a second Undo is the plain reopen.
    updateTask.mockClear()
    await uncompleteTaskRequest(a, [])
    expect(patchCalls()).toEqual([[10, { done: false }]])
  })

  it('does nothing special for a task that really finished', async () => {
    const plain = task(10, { due_date: BEFORE })
    updateTask.mockResolvedValueOnce(ok({ ...plain, done: true }))
    await completeTaskRequest(plain)
    updateTask.mockClear()

    await uncompleteTaskRequest(plain, [])

    expect(fetchTaskById).not.toHaveBeenCalled()
    expect(patchCalls()).toEqual([[10, { done: false }]])
  })

  it('falls back to the plain reopen when the task cannot be read', async () => {
    const before = repeating(10)
    updateTask.mockResolvedValueOnce(ok(advanced(10)))
    await completeTaskRequest(before)
    updateTask.mockClear()
    fetchTaskById.mockResolvedValueOnce({ success: false, error: 'offline' })

    await uncompleteTaskRequest(before, [])

    expect(patchCalls()).toEqual([[10, { done: false }]])
  })
})

describe('updateProjectRequest', () => {
  it('rename sends only the title', async () => {
    const original = project(5)

    await updateProjectRequest({ id: 5, changes: { title: 'Renamed' }, original })

    expect(updateProject).toHaveBeenCalledWith(5, { title: 'Renamed' })
  })

  it('settings send only changed fields and parent_project_id only when it changes', async () => {
    const original = project(5)

    await updateProjectRequest({
      id: 5,
      changes: { title: 'Renamed', hex_color: '#3498db', parent_project_id: 4 },
      original,
    })
    expect(updateProject).toHaveBeenLastCalledWith(5, { title: 'Renamed' })

    await updateProjectRequest({
      id: 5,
      changes: { title: 'Renamed', hex_color: '#3498db', parent_project_id: 9 },
      original,
    })
    expect(updateProject).toHaveBeenLastCalledWith(5, { title: 'Renamed', parent_project_id: 9 })
  })

  it('reorder and archive send a single field', async () => {
    await updateProjectRequest({ id: 5, changes: { position: 512 } })
    expect(updateProject).toHaveBeenLastCalledWith(5, { position: 512 })

    await updateProjectRequest({ id: 5, changes: { is_archived: true }, original: project(5) })
    expect(updateProject).toHaveBeenLastCalledWith(5, { is_archived: true })
  })

  it('never sends children or any key outside the PATCH schema, even for a tree node', async () => {
    const treeNode = {
      ...project(5),
      children: [{ ...project(6), children: [] }],
      views: [{ id: 1 }],
      owner: { id: 1 },
    } as unknown as Project

    await updateProjectRequest({
      id: 5,
      changes: { ...treeNode, description: 'Reviewed' },
      original: treeNode,
    })

    const sent = updateProject.mock.calls[0][1] as Record<string, unknown>
    expect(sent).toEqual({ description: 'Reviewed' })
    for (const key of Object.keys(sent)) expect(PROJECT_WRITABLE_FIELDS as readonly string[]).toContain(key)
    expect('children' in sent).toBe(false)
  })

  it('skips the request when nothing differs', async () => {
    const original = project(5)

    const result = await updateProjectRequest({ id: 5, changes: { title: original.title }, original })

    expect(updateProject).not.toHaveBeenCalled()
    expect(result).toBe(original)
  })

  it('throws the server error', async () => {
    updateProject.mockResolvedValueOnce({ success: false, error: 'validation failed' })

    await expect(updateProjectRequest({ id: 5, changes: { title: 'x' } })).rejects.toThrow('validation failed')
  })
})

describe('main-window changes that go into the offline queue (D-SYNC-6, decision 4)', () => {
  // The main process queues a change the server cannot take, and one that arrives while changes
  // for the task are waiting (src/main/offline/task-writes.ts); the window sees `queued: true`.
  const queuedReply = { success: true as const, queued: true as const, data: null }
  const queuedOk = { success: true as const, data: { actionId: 'a', taskId: 1, folded: false } }
  let enqueueUpdate: ReturnType<typeof vi.fn>
  let cancelChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    enqueueUpdate = vi.fn(async () => queuedOk)
    cancelChange = vi.fn(async () => ({ success: true as const, data: true }))
    vi.stubGlobal('window', { api: { updateTask, updateProject, offlineQueue: { enqueueUpdate, cancelChange } } })
    useOfflineStore.setState({ counts: { pending: 0, failed: 0 } })
  })

  it('an edit the main process queued resolves with the optimistic task', async () => {
    updateTask.mockResolvedValueOnce(queuedReply)
    const original = task(1)

    const result = await updateTaskRequest({ id: 1, changes: { priority: 3 }, original })

    expect(updateTask).toHaveBeenCalledWith(1, { priority: 3 }, { queue: true, title: 'Task 1' })
    expect(result).toMatchObject({ id: 1, priority: 3, title: 'Task 1' })
  })

  it('an edit the server refuses is not queued: the error reaches the caller so the cache rolls back', async () => {
    updateTask.mockResolvedValueOnce({ success: false, error: 'Invalid priority', statusCode: 422 })

    await expect(updateTaskRequest({ id: 1, changes: { priority: 9 }, original: task(1) })).rejects.toThrow('Invalid priority')
    expect(enqueueUpdate).not.toHaveBeenCalled()
  })

  it('an edit to a task that only exists as a pending create never goes to the server', async () => {
    const pending = task(-3, { title: 'Offline task' })

    await updateTaskRequest({ id: -3, changes: { title: 'Renamed' }, original: pending })

    expect(updateTask).not.toHaveBeenCalled()
    expect(enqueueUpdate).toHaveBeenCalledWith(-3, { title: 'Renamed' }, { title: 'Offline task' })
  })

  it('completing offline sends every step, children first, and does not fail', async () => {
    updateTask.mockResolvedValue(queuedReply)
    const child1 = { id: 11, title: 'Child 1', done: false } as unknown as Task
    const child2 = { id: 12, title: 'Child 2', done: false } as unknown as Task
    const parent = task(10, { related_tasks: { subtask: [child1, child2] } })

    const result = await completeTaskRequest(parent)

    expect(updateTask.mock.calls).toEqual([
      [12, { done: true }, { queue: true, title: 'Child 2' }],
      [11, { done: true }, { queue: true, title: 'Child 1' }],
      [10, { done: true }, { queue: true, title: 'Task 10' }],
    ])
    expect(result.done).toBe(true)
  })

  it('takes a queued child completion back out of the queue when the parent is refused', async () => {
    const child = { id: 11, title: 'Child', done: false } as unknown as Task
    const parent = task(10, { related_tasks: { subtask: [child] } })
    updateTask.mockResolvedValueOnce(queuedReply).mockResolvedValueOnce({ success: false, error: 'nope', statusCode: 403 })

    await expect(completeTaskRequest(parent)).rejects.toThrow('nope')

    expect(cancelChange).toHaveBeenCalledWith(11, ['done'])
    // The cancel worked, so no request undoes it.
    expect(patchCalls()).toEqual([
      [11, { done: true }],
      [10, { done: true }],
    ])
  })

  it('undoing a completion that is still queued cancels it instead of sending a reopen', async () => {
    useOfflineStore.setState({ counts: { pending: 1, failed: 0 } })

    await uncompleteTaskRequest(task(10, { done: true }), [])

    expect(cancelChange).toHaveBeenCalledWith(10, ['done'])
    expect(updateTask).not.toHaveBeenCalled()
    expect(enqueueUpdate).not.toHaveBeenCalled()
  })

  it('undoing asks for the reopen to be sent or queued when the completion had already been sent', async () => {
    useOfflineStore.setState({ counts: { pending: 1, failed: 0 } })
    cancelChange.mockResolvedValueOnce({ success: true, data: false })
    updateTask.mockResolvedValueOnce(queuedReply)

    await uncompleteTaskRequest(task(10, { done: true }), [])

    expect(updateTask).toHaveBeenCalledWith(10, { done: false }, { queue: true, title: 'Task 10' })
  })

  it('does not ask the queue about a completion when nothing is pending', async () => {
    await uncompleteTaskRequest(task(10, { done: true }), [])

    expect(cancelChange).not.toHaveBeenCalled()
    expect(updateTask).toHaveBeenCalledWith(10, { done: false }, { queue: true, title: 'Task 10' })
  })
})
