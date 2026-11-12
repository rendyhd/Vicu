import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import { classifyReplayFailure } from '../offline/classify'
import { findQueuedComment, overlayComments } from '../offline/comment-overlay'
import {
  mergeAddAssignee,
  mergeDeleteComment,
  mergeRemoveAssignee,
  mergeUpdateComment,
  remapTempCommentId,
} from '../offline/queue-merge'
import { normalizeAction } from '../offline/queue-parse'
import { describeAction } from '../offline/summary'
import { writeTask, taskWrites } from '../offline/task-writes'
import type { AddAssigneeAction, CreateCommentAction, DeleteCommentAction, RemoveAssigneeAction, UpdateCommentAction } from '../offline/types'
import type { ApiResult } from '../api-result'

// Assignee and comment changes in the offline queue (docs/cross-app-semantics-v1.md section 9.6).

const T0 = '2026-10-10T10:00:00.000Z'
let counter = 0
const nextId = () => `c${++counter}`

const assign = (taskId: number, userId: number): AddAssigneeAction => ({ id: nextId(), type: 'add-assignee', createdAt: T0, attempts: 0, taskId, userId })
const unassign = (taskId: number, userId: number): RemoveAssigneeAction => ({ id: nextId(), type: 'remove-assignee', createdAt: T0, attempts: 0, taskId, userId })
const createComment = (taskId: number, tempCommentId: number, comment = '<p>hi</p>'): CreateCommentAction => ({
  id: nextId(), type: 'create-comment', createdAt: T0, attempts: 0, taskId, tempCommentId, comment,
})
const editComment = (taskId: number, commentId: number, comment: string): UpdateCommentAction => ({
  id: nextId(), type: 'update-comment', createdAt: T0, attempts: 0, taskId, commentId, comment,
})
const deleteComment = (taskId: number, commentId: number): DeleteCommentAction => ({
  id: nextId(), type: 'delete-comment', createdAt: T0, attempts: 0, taskId, commentId,
})

describe('assignee folding', () => {
  it('an assign followed by an unassign of the same user cancels out', () => {
    const a = assign(5, 2)
    const result = mergeRemoveAssignee([a], unassign(5, 2), null)
    expect(result.actions).toEqual([])
    expect(result.removed).toEqual([a])
  })
  it('an unassign followed by an assign cancels out', () => {
    const r = unassign(5, 2)
    expect(mergeAddAssignee([r], assign(5, 2), null).actions).toEqual([])
  })
  it('does not queue the same assign twice', () => {
    const a = assign(5, 2)
    expect(mergeAddAssignee([a], assign(5, 2), null)).toMatchObject({ actions: [a], noop: true })
  })
  it('does not cancel against a change that is being sent', () => {
    const a = assign(5, 2)
    const r = unassign(5, 2)
    expect(mergeRemoveAssignee([a], r, a.id).actions).toEqual([a, r])
  })
  it('other users and other tasks do not interact', () => {
    const a = assign(5, 2)
    expect(mergeRemoveAssignee([a], unassign(5, 3), null).actions).toHaveLength(2)
    expect(mergeRemoveAssignee([a], unassign(6, 2), null).actions).toHaveLength(2)
  })
})

describe('comment folding', () => {
  it('an edit of a comment waiting to be created goes into the create', () => {
    const c = createComment(5, -20)
    const result = mergeUpdateComment([c], editComment(5, -20, '<p>better</p>'), null)
    expect(result.actions).toEqual([{ ...c, comment: '<p>better</p>' }])
    expect(result.foldedInto).toBe(c.id)
  })
  it('two edits of one comment keep the last text', () => {
    const e = editComment(5, 300, '<p>one</p>')
    const result = mergeUpdateComment([e], editComment(5, 300, '<p>two</p>'), null)
    expect(result.actions).toEqual([{ ...e, comment: '<p>two</p>' }])
  })
  it('deleting a comment waiting to be created removes the create and its edits', () => {
    const c = createComment(5, -20)
    const result = mergeDeleteComment([c], deleteComment(5, -20), null)
    expect(result.actions).toEqual([])
    expect(result.removed).toEqual([c])
  })
  it('a delete after an edit replaces the edit', () => {
    const e = editComment(5, 300, '<p>one</p>')
    const d = deleteComment(5, 300)
    expect(mergeDeleteComment([e], d, null).actions).toEqual([d])
  })
  it('a create that is being sent stays, and the delete waits behind it', () => {
    const c = createComment(5, -20)
    const d = deleteComment(5, -20)
    expect(mergeDeleteComment([c], d, c.id).actions).toEqual([c, d])
  })
  it('edits and deletes of a comment sent meanwhile move to its real id', () => {
    const e = editComment(5, -20, '<p>x</p>')
    const d = deleteComment(5, -20)
    const other = editComment(5, -21, '<p>y</p>')
    expect(remapTempCommentId([e, d, other], -20, 700)).toEqual([{ ...e, commentId: 700 }, { ...d, commentId: 700 }, other])
  })
})

describe('parsing and summaries', () => {
  it('reads the new actions back and refuses broken ones', () => {
    expect(normalizeAction({ id: 'x', type: 'add-assignee', taskId: 5, userId: 2, username: 'maya' })).toMatchObject({ type: 'add-assignee', userId: 2, username: 'maya' })
    expect(normalizeAction({ id: 'x', type: 'add-assignee', taskId: 5, userId: 0 })).toBeNull()
    expect(normalizeAction({ id: 'x', type: 'create-comment', taskId: 5, tempCommentId: -3, comment: '<p>a</p>' })).toMatchObject({ tempCommentId: -3 })
    expect(normalizeAction({ id: 'x', type: 'create-comment', taskId: 5, tempCommentId: 3, comment: '<p>a</p>' })).toBeNull()
    expect(normalizeAction({ id: 'x', type: 'update-comment', taskId: 5, commentId: 9, comment: '' })).toBeNull()
    expect(normalizeAction({ id: 'x', type: 'delete-comment', taskId: 5, commentId: 9 })).toMatchObject({ commentId: 9 })
  })
  it('names each change for the sync panel', () => {
    expect(describeAction({ ...assign(5, 2), username: 'maya', title: 'Buy milk' })).toBe('Assign @maya to "Buy milk"')
    expect(describeAction({ ...unassign(5, 2), title: 'Buy milk' })).toBe('Unassign user #2 from "Buy milk"')
    expect(describeAction({ ...createComment(5, -1), title: 'Buy milk' })).toBe('Comment on "Buy milk"')
    expect(describeAction(editComment(5, 9, '<p>a</p>'))).toBe('Edit a comment on task #5')
    expect(describeAction(deleteComment(5, 9))).toBe('Delete a comment on task #5')
  })
})

describe('replay failures', () => {
  it('a 403 drops an assignee or comment change instead of stopping the queue', () => {
    for (const type of ['add-assignee', 'remove-assignee', 'create-comment', 'update-comment', 'delete-comment'] as const) {
      expect(classifyReplayFailure({ error: 'You can only read this project', statusCode: 403 }, type)).toEqual({ kind: 'drop', reason: 'forbidden' })
    }
    expect(classifyReplayFailure({ error: 'Forbidden', statusCode: 403 }, 'update')).toEqual({ kind: 'stop', why: 'auth' })
  })
  it('an API token without the permission drops the change with its own reason (9.7)', () => {
    const failure = { error: 'Your API token does not have this permission.', statusCode: 403, tokenPermission: true }
    for (const type of ['add-assignee', 'remove-assignee', 'create-comment', 'update-comment', 'delete-comment'] as const) {
      expect(classifyReplayFailure(failure, type)).toEqual({ kind: 'drop', reason: 'token-permission' })
    }
  })
  it('deleting or unassigning something already gone is done', () => {
    expect(classifyReplayFailure({ error: 'gone', statusCode: 404 }, 'delete-comment')).toEqual({ kind: 'done' })
    expect(classifyReplayFailure({ error: 'gone', statusCode: 404 }, 'remove-assignee')).toEqual({ kind: 'done' })
    expect(classifyReplayFailure({ error: 'gone', statusCode: 404 }, 'update-comment')).toEqual({ kind: 'drop', reason: 'not-found' })
    expect(classifyReplayFailure({ error: 'gone', statusCode: 404 }, 'create-comment')).toEqual({ kind: 'drop', reason: 'task-gone' })
  })
})

describe('the thread with the queue laid over it', () => {
  const server = [
    { id: 12, comment: '<p>newest</p>', author: { id: 2 }, created: '2026-10-10T09:00:00Z' },
    { id: 11, comment: '<p>older</p>', author: { id: 1 }, created: '2026-10-09T09:00:00Z' },
  ]
  it('puts comments written offline first (newest), applies edits and hides deletes', () => {
    const actions = [createComment(5, -1, '<p>a</p>'), createComment(5, -2, '<p>b</p>'), editComment(5, 11, '<p>edited</p>'), deleteComment(5, 12)]
    const items = overlayComments(server, actions, 1, 1) as Array<{ id: number; comment: string; pending?: true }>
    expect(items.map((c) => [c.id, c.comment, c.pending ?? false])).toEqual([
      [-2, '<p>b</p>', true],
      [-1, '<p>a</p>', true],
      [11, '<p>edited</p>', true],
    ])
  })
  it('adds the offline comments to the first page only', () => {
    expect(overlayComments(server, [createComment(5, -1)], 2, 1)).toEqual(server)
  })
  it('finds the comment an unconfirmed create already stored', () => {
    const items = [
      { id: 40, comment: '<p>hi</p>', author: { id: 2 }, created: '2026-10-10T10:00:05Z' },
      { id: 41, comment: '<p>hi</p>', author: { id: 1 }, created: '2026-10-10T10:00:05Z' },
    ]
    expect(findQueuedComment(items, '<p>hi</p>', T0, 1)).toEqual({ id: 41 })
    expect(findQueuedComment(items, '<p>other</p>', T0, 1)).toBeNull()
    expect(findQueuedComment([{ ...items[1], created: '2026-10-09T10:00:00Z' }], '<p>hi</p>', T0, 1)).toBeNull()
  })
})

describe('queue and replay end to end', () => {
  let dir: string
  let queue: OfflineQueue
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-collab-'))
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

  function fakeApi(overrides: Partial<ReplayApi> = {}) {
    const calls: string[] = []
    let nextComment = 900
    const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ success: true, data })
    const api: ReplayApi = {
      createTask: async (projectId, payload) => (calls.push(`createTask ${payload.title}`), ok({ id: 77 })),
      updateTask: async (id) => (calls.push(`updateTask ${id}`), ok({ id })),
      deleteTask: async (id) => (calls.push(`deleteTask ${id}`), ok(undefined)),
      addLabelToTask: async () => ok(undefined),
      removeLabelFromTask: async () => ok(undefined),
      fetchLabels: async () => ok([]),
      createLabel: async () => ok({ id: 1 }),
      uploadTaskAttachment: async () => ok({}),
      fetchTaskAttachments: async () => ok([]),
      fetchTaskById: async (id) => ok({ id }),
      findRecentCreate: async () => ok(null),
      addTaskAssignee: async (taskId, userId) => (calls.push(`assign ${taskId} ${userId}`), ok(null)),
      removeTaskAssignee: async (taskId, userId) => (calls.push(`unassign ${taskId} ${userId}`), ok(undefined)),
      createTaskRelation: async (taskId, otherTaskId, kind) => (calls.push(`relate ${taskId} ${kind} ${otherTaskId}`), ok(null)),
      deleteTaskRelation: async (taskId, kind, otherTaskId) => (calls.push(`unrelate ${taskId} ${kind} ${otherTaskId}`), ok(undefined)),
      createTaskComment: async (taskId, html) => {
        const id = nextComment++
        calls.push(`comment ${taskId} ${html} -> ${id}`)
        return ok({ id })
      },
      updateTaskComment: async (taskId, commentId, html) => (calls.push(`edit ${taskId} ${commentId} ${html}`), ok({ id: commentId })),
      deleteTaskComment: async (taskId, commentId) => (calls.push(`delete-comment ${taskId} ${commentId}`), ok(undefined)),
      findRecentComment: async () => ok(null),
      ...overrides,
    }
    return { api, calls }
  }

  it('sends the changes of a task created offline after its create, with the real id, in order', async () => {
    const created = await queue.enqueueCreate({ projectId: 3, fields: { title: 'Plan' } })
    await queue.enqueueAddAssignee(created.tempId, 2, { username: 'maya' })
    const comment = await queue.enqueueCreateComment(created.tempId, '<p>first</p>')
    await queue.enqueueUpdateComment(created.tempId, comment.tempCommentId, '<p>first, edited</p>')
    expect(queue.counts().pending).toBe(3)

    const { api, calls } = fakeApi()
    const result = await replayQueue(queue, api)
    expect(result).toMatchObject({ stopped: null, applied: 3 })
    expect(calls).toEqual(['createTask Plan', 'assign 77 2', 'comment 77 <p>first, edited</p> -> 900'])
  })

  it('an edit queued while its create was in flight goes to the real id', async () => {
    const comment = await queue.enqueueCreateComment(5, '<p>a</p>')
    const action = queue.nextAction()!
    queue.beginSend(action.id)
    await queue.enqueueUpdateComment(5, comment.tempCommentId, '<p>b</p>')
    queue.endSend()
    const { api, calls } = fakeApi()
    await replayQueue(queue, api)
    expect(calls).toEqual(['comment 5 <p>a</p> -> 900', 'edit 5 900 <p>b</p>'])
    expect(queue.resolveCommentRef(comment.tempCommentId)).toBe(900)
  })

  it('a comment create that may have reached the server is looked up before it is sent again', async () => {
    await queue.enqueueCreateComment(5, '<p>a</p>')
    const failing = fakeApi({ createTaskComment: async () => ({ success: false, error: 'Request timed out (10s)' }) })
    const first = await replayQueue(queue, failing.api)
    expect(first.stopped).toBe('network')
    expect(queue.nextAction()).toMatchObject({ type: 'create-comment', maybeSent: true })

    const found = fakeApi({ findRecentComment: async () => ({ success: true, data: { id: 555 } }) })
    await replayQueue(queue, found.api)
    expect(found.calls).toEqual([])
    expect(queue.counts().pending).toBe(0)
  })

  it('a 403 on a comment goes to the failed log and the rest still replays', async () => {
    await queue.enqueueCreateComment(5, '<p>a</p>')
    await queue.enqueueUpdate(6, { title: 'x' })
    const { api, calls } = fakeApi({ createTaskComment: async () => ({ success: false, error: 'You can only read this project', statusCode: 403 }) })
    const result = await replayQueue(queue, api)
    expect(result).toMatchObject({ stopped: null, failed: 1 })
    expect(calls).toEqual(['updateTask 6'])
    expect(queue.snapshot().failed[0]).toMatchObject({ type: 'create-comment', reason: 'forbidden' })
  })

  it('a comment the API token may not write goes to the failed log and the rest still replays', async () => {
    await queue.enqueueCreateComment(5, '<p>a</p>')
    await queue.enqueueUpdate(6, { title: 'x' })
    const error = 'Your API token does not have this permission.'
    const { api, calls } = fakeApi({ createTaskComment: async () => ({ success: false, error, statusCode: 403, tokenPermission: true }) })
    const result = await replayQueue(queue, api)
    expect(result).toMatchObject({ stopped: null, failed: 1 })
    expect(calls).toEqual(['updateTask 6'])
    expect(queue.snapshot().failed[0]).toMatchObject({ type: 'create-comment', reason: 'token-permission', error })
    expect(queue.snapshot().authProblem ?? null).toBeNull()
  })

  it('the write gate queues an assignee change behind waiting changes, and a comment only when nothing was sent', async () => {
    await queue.enqueueUpdate(5, { title: 'waiting' })
    let sent = 0
    const api = {
      addTaskAssignee: async () => (sent++, { success: true as const, data: null }),
      createTaskComment: async () => ({ success: false as const, error: 'Request timed out (10s)' }),
    }
    const deps = { queue }
    const assigned = await writeTask(deps, taskWrites.addAssignee(queue, api, 5, { id: 2, username: 'maya' }), { queue: true })
    expect(assigned).toMatchObject({ kind: 'queued', reason: 'behind-queue' })
    expect(sent).toBe(0)

    // A timeout may have stored the comment: it is not queued (the replay could post it twice).
    const commented = await writeTask(deps, taskWrites.createComment(queue, api, 9, '<p>a</p>'), { queue: true })
    expect(commented.kind).toBe('refused')
    const offline = await writeTask(
      deps,
      taskWrites.createComment(queue, { createTaskComment: async () => ({ success: false, error: 'net::ERR_INTERNET_DISCONNECTED' }) }, 9, '<p>a</p>'),
      { queue: true },
    )
    expect(offline).toMatchObject({ kind: 'queued', reason: 'unreachable' })
    expect((offline as { enqueued?: { tempCommentId: number } }).enqueued?.tempCommentId).toBeLessThan(0)
  })

  it('keeps the temp ids of comments apart from those of tasks after a reload', async () => {
    const created = await queue.enqueueCreate({ projectId: 3, fields: { title: 'A' } })
    const comment = await queue.enqueueCreateComment(5, '<p>a</p>')
    expect(comment.tempCommentId).toBeLessThan(created.tempId)
    const reloaded = new OfflineQueue({ queuePath: join(dir, 'offline-queue.json'), attachmentsDir: join(dir, 'offline-attachments') })
    reloaded.load()
    const next = await reloaded.enqueueCreate({ projectId: 3, fields: { title: 'B' } })
    expect(next.tempId).toBeLessThan(comment.tempCommentId)
  })
})
