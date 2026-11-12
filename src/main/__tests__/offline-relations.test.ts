import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import { classifyReplayFailure } from '../offline/classify'
import type { ApiResult } from '../api-result'

/**
 * Pro's "after" relations go through the offline queue (decision 24, cross-app semantics 21.2): an
 * add and a removal of the same relation cancel, both task ids may be temp ids that the replay
 * rewrites, a relation to a task whose create failed is a dependency failure, and the server's
 * "already there" (409) and "already gone" (404) count as done.
 */

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ success: true, data })

function fakeApi(overrides: Partial<ReplayApi> = {}) {
  const calls: string[] = []
  let nextId = 500
  const api: ReplayApi = {
    createTask: async (_projectId, payload) => {
      const id = nextId++
      calls.push(`create ${payload.title} -> ${id}`)
      return ok({ id })
    },
    updateTask: async (id) => (calls.push(`update ${id}`), ok({ id })),
    deleteTask: async (id) => (calls.push(`delete ${id}`), ok(undefined)),
    addLabelToTask: async () => ok(undefined),
    removeLabelFromTask: async () => ok(undefined),
    fetchLabels: async () => ok([]),
    createLabel: async () => ok({ id: 1 }),
    uploadTaskAttachment: async () => ok({}),
    fetchTaskAttachments: async () => ok([]),
    fetchTaskById: async (id) => ok({ id }),
    findRecentCreate: async () => ok(null),
    addTaskAssignee: async () => ok(null),
    removeTaskAssignee: async () => ok(undefined),
    createTaskRelation: async (taskId, otherTaskId, kind) => (calls.push(`relate ${taskId} ${kind} ${otherTaskId}`), ok(null)),
    deleteTaskRelation: async (taskId, kind, otherTaskId) => (calls.push(`unrelate ${taskId} ${kind} ${otherTaskId}`), ok(undefined)),
    createTaskComment: async () => ok({ id: 1 }),
    updateTaskComment: async () => ok({ id: 1 }),
    deleteTaskComment: async () => ok(undefined),
    findRecentComment: async () => ok(null),
    ...overrides,
  }
  return { api, calls }
}

describe('relations in the offline queue', () => {
  let dir: string
  let queue: OfflineQueue
  let counter = 0
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-relations-'))
    counter = 0
    queue = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++counter}`,
    })
    queue.load()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('replays an add and a removal', async () => {
    await queue.enqueueAddRelation(5, 6, 'blocked')
    await queue.enqueueRemoveRelation(7, 8, 'blocked')
    const { api, calls } = fakeApi()
    const result = await replayQueue(queue, api)
    expect(calls).toEqual(['relate 5 blocked 6', 'unrelate 7 blocked 8'])
    expect(result).toMatchObject({ applied: 2, stopped: null })
  })

  it('cancels an add with a removal of the same relation, and the same add twice is one', async () => {
    await queue.enqueueAddRelation(5, 6, 'blocked')
    await queue.enqueueAddRelation(5, 6, 'blocked')
    expect(queue.counts().pending).toBe(1)
    await queue.enqueueRemoveRelation(5, 6, 'blocked')
    expect(queue.counts().pending).toBe(0)
  })

  it('rewrites both temp ids once their creates replay', async () => {
    const first = await queue.enqueueCreate({ projectId: 3, fields: { title: 'Draft' } })
    const second = await queue.enqueueCreate({ projectId: 3, fields: { title: 'Review' } })
    await queue.enqueueAddRelation(second.tempId, first.tempId, 'blocked')
    const { api, calls } = fakeApi()
    await replayQueue(queue, api)
    expect(calls).toEqual(['create Draft -> 500', 'create Review -> 501', 'relate 501 blocked 500'])
  })

  it('a relation to a task whose create failed goes to the failed log', async () => {
    const first = await queue.enqueueCreate({ projectId: 3, fields: { title: 'Draft' } })
    await queue.enqueueAddRelation(9, first.tempId, 'blocked')
    const { api, calls } = fakeApi({
      createTask: async () => ({ success: false, error: 'Bad request', statusCode: 400 }),
    })
    await replayQueue(queue, api)
    expect(calls).toEqual([])
    expect(queue.counts().pending).toBe(0)
    expect(queue.counts().failed).toBeGreaterThanOrEqual(1)
  })

  it('treats "already there" and "already gone" as done', () => {
    expect(classifyReplayFailure({ error: 'exists', statusCode: 409 }, 'add-relation')).toEqual({ kind: 'done' })
    expect(classifyReplayFailure({ error: 'missing', statusCode: 404 }, 'remove-relation')).toEqual({ kind: 'done' })
    expect(classifyReplayFailure({ error: 'missing', statusCode: 404 }, 'add-relation')).toEqual({ kind: 'drop', reason: 'task-gone' })
  })
})
