import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import {
  AUTO_COMPLETED_SUBTASKS_KEY,
  createFromQuickEntry,
  quickViewComplete,
  quickViewPatch,
  quickViewReopen,
  type QuickActionDeps,
} from '../offline/quick-actions'
import type { ApiResult } from '../api-result'
import type { CreateAction } from '../offline/types'

const ok = (data: unknown = {}): ApiResult<unknown> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<unknown> => ({ success: false, error, statusCode })

describe('Quick Entry and Quick View with the offline queue', () => {
  let dir: string
  let queue: OfflineQueue
  let idCounter: number
  let warn: ReturnType<typeof vi.spyOn>
  let notified: number
  let createTask: ReturnType<typeof vi.fn>
  let updateTask: ReturnType<typeof vi.fn>

  const deps = (): QuickActionDeps => ({
    queue,
    api: { createTask: createTask as never, updateTask: updateTask as never },
    notifyMainWindow: () => void notified++,
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-quick-actions-'))
    idCounter = 0
    notified = 0
    queue = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++idCounter}`,
    })
    queue.load()
    createTask = vi.fn(async () => ok({ id: 100 }))
    updateTask = vi.fn(async () => ok({}))
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('Quick Entry create', () => {
    const payload = {
      title: 'Water plants',
      description: '<p>front room</p>',
      due_date: '2026-10-08T14:30:00.000Z',
      priority: 3,
      repeat_after: 604800,
      repeat_mode: 0,
    }

    it('online: sends the create and queues nothing', async () => {
      const result = await createFromQuickEntry(deps(), 7, payload)
      expect(result).toEqual({ success: true, data: { id: 100 } })
      expect(createTask).toHaveBeenCalledWith(7, payload)
      expect(queue.counts().pending).toBe(0)
      expect(notified).toBe(1)
    })

    it('offline: queues every field, the labels and the pasted images with the create (D-SYNC-3, D-QE-1)', async () => {
      createTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))

      const result = await createFromQuickEntry(deps(), 7, payload, {
        labels: [{ id: 3, title: 'Home' }, { title: 'Garden' }],
        images: [{ name: 'shot.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
      })

      expect(result).toMatchObject({ success: true, cached: true, pendingId: expect.stringMatching(/^pending_/) })
      const pending = queue.getPending()
      expect(pending.map((a) => a.type)).toEqual(['create', 'add-label', 'add-label', 'upload-attachment'])
      expect(pending[0]).toMatchObject({ projectId: 7, fields: payload })
      expect(pending[1]).toMatchObject({ labelId: 3 })
      expect(pending[2]).toMatchObject({ labelTitle: 'Garden' })
      expect(pending[3]).toMatchObject({ name: 'shot.png', mime: 'image/png' })
      expect(notified).toBe(0)
    })

    it.each([
      ['ECONNREFUSED 127.0.0.1:3456', undefined],
      ['HTTP 503', 503],
      ['HTTP 504', 504],
      ['HTTP 429', 429],
    ])('queues when the request never created anything: %s', async (message, status) => {
      createTask.mockResolvedValue(err(message, status))
      const result = await createFromQuickEntry(deps(), 7, payload)
      expect(result).toMatchObject({ success: true, cached: true })
      expect(queue.counts().pending).toBe(1)
    })

    it.each([
      ['Request timed out (10s)', undefined],
      ['socket hang up', undefined],
      ['Server error — Vikunja may be experiencing issues.', 500],
    ])('does not queue a create that may have been applied (duplicate risk): %s', async (message, status) => {
      createTask.mockResolvedValue(err(message, status))
      const result = await createFromQuickEntry(deps(), 7, payload)
      expect(result).toMatchObject({ success: false })
      expect(queue.counts().pending).toBe(0)
    })

    it.each([
      [err('validation failed', 422)],
      [err('API token is invalid or expired.', 401)],
      [err('Session expired. Please sign in again.')],
    ])('reports an error that is not about the connection instead of queueing it', async (failure) => {
      createTask.mockResolvedValue(failure)
      expect(await createFromQuickEntry(deps(), 7, payload)).toEqual(failure)
      expect(queue.counts().pending).toBe(0)
    })

    it('does not claim "saved offline" when part of it cannot be kept: an oversized image fails the save', async () => {
      createTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      const result = await createFromQuickEntry(deps(), 7, payload, {
        images: [{ name: 'huge.png', mime: 'image/png', bytes: new Uint8Array(26 * 1024 * 1024) }],
      })
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/Could not save offline.*too large/) })
      expect(queue.counts().pending).toBe(0)
    })

    it('ignores malformed extras instead of failing the save', async () => {
      createTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      const result = await createFromQuickEntry(deps(), 7, payload, {
        labels: ['x', null, { id: -4 }, { id: 'z' }, {}],
        images: [{ name: 'a', mime: 'image/png', bytes: 'not bytes' }, null],
      })
      expect(result).toMatchObject({ success: true, cached: true })
      expect(queue.getPending().map((a) => a.type)).toEqual(['create'])
    })
  })

  describe('Quick View complete / reopen', () => {
    it('online: completes with { done: true } and notifies the main window', async () => {
      const result = await quickViewComplete(deps(), 5, { id: 5, title: 'Pay rent' })
      expect(updateTask).toHaveBeenCalledWith(5, { done: true })
      expect(result).toMatchObject({ success: true })
      expect(queue.counts().pending).toBe(0)
      expect(notified).toBe(1)
    })

    it('offline: queues only { done: true }, never the cached snapshot (D-SYNC-2)', async () => {
      updateTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      const snapshot = { id: 5, title: 'Pay rent', description: 'old text', priority: 4, labels: [{ id: 1 }], created: 'x' }

      const result = await quickViewComplete(deps(), 5, snapshot)

      expect(result).toEqual({ success: true, cached: true })
      expect(queue.getPending()).toMatchObject([{ type: 'update', taskId: 5, patch: { done: true } }])
      expect(Object.keys((queue.getPending()[0] as { patch: object }).patch)).toEqual(['done'])
    })

    it('queues on a 5xx or 429 too, but not on a rejection or an auth failure', async () => {
      for (const [failure, queued] of [
        [err('HTTP 503', 503), true],
        [err('HTTP 429', 429), true],
        [err('validation failed', 422), false],
        [err('API token is invalid', 401), false],
      ] as const) {
        queue.getPending().forEach(() => {})
        const before = queue.counts().pending
        updateTask.mockResolvedValueOnce(failure)
        const result = await quickViewComplete(deps(), 70 + before, { id: 70 + before })
        expect(result.success).toBe(queued)
        expect(queue.counts().pending).toBe(before + (queued ? 1 : 0))
      }
    })

    it('undo of a completion still in the queue takes it out: the server never hears about it', async () => {
      updateTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      await quickViewComplete(deps(), 5, { id: 5, title: 'x' })
      updateTask.mockClear()

      const result = await quickViewReopen(deps(), 5, { id: 5, title: 'x' })

      expect(result).toMatchObject({ success: true, cancelledPending: true })
      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.counts().pending).toBe(0)
    })

    it('undo of a completion that is on the wire queues the reopen behind it (D-SYNC-4)', async () => {
      updateTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      const first = await queue.enqueueComplete(5, true)
      queue.beginSend(first.actionId) // the replay is sending it right now
      updateTask.mockClear()

      const result = await quickViewReopen(deps(), 5, { id: 5 })

      // Nothing could be cancelled; the server is tried, and the reopen is queued because it is unreachable.
      expect(result).toMatchObject({ success: true, cached: true })
      expect((result as { cancelledPending?: boolean }).cancelledPending).toBeUndefined()
      expect(queue.getPending().map((a) => (a as { patch?: object }).patch)).toEqual([{ done: true }, { done: false }])
    })

    it('completing the parent completes its unfinished subtasks, and an undo reverses all of them', async () => {
      updateTask.mockResolvedValue(err('net::ERR_INTERNET_DISCONNECTED'))
      const parent = {
        id: 1, title: 'Parent',
        related_tasks: { subtask: [{ id: 2, title: 'a', done: false, related_tasks: { subtask: [{ id: 3, title: 'b', done: false }] } }, { id: 4, title: 'c', done: true }] },
      }
      const completed = await quickViewComplete(deps(), 1, parent)
      expect(completed).toMatchObject({ success: true, cached: true })
      expect(queue.getPending().map((a) => (a as { taskId: number }).taskId)).toEqual([3, 2, 1])

      const undone = await quickViewReopen(deps(), 1, { ...parent, [AUTO_COMPLETED_SUBTASKS_KEY]: [{ id: 2, title: 'a' }, { id: 3, title: 'b' }] })
      expect(undone).toMatchObject({ success: true, cancelledPending: true })
      expect(queue.counts().pending).toBe(0)
    })

    it('a refused step rolls the earlier ones back', async () => {
      const parent = { id: 1, title: 'P', related_tasks: { subtask: [{ id: 2, title: 'a', done: false }] } }
      updateTask.mockImplementation(async (id: number, patch: { done: boolean }) =>
        id === 1 && patch.done ? err('validation failed', 422) : ok()
      )

      const result = await quickViewComplete(deps(), 1, parent)

      expect(result).toMatchObject({ success: false, error: 'validation failed' })
      // the subtask had reached the server, so it is reopened
      expect(updateTask.mock.calls).toEqual([[2, { done: true }], [1, { done: true }], [2, { done: false }]])
    })

    it('numeric ids sent as strings are the same task', async () => {
      await quickViewComplete(deps(), '5', { id: 5 })
      expect(updateTask).toHaveBeenCalledWith(5, { done: true })
    })
  })

  describe('rows for tasks that only exist in the queue (D-SYNC-4)', () => {
    let pendingId: string
    let tempId: number
    const row = () => ({ id: pendingId, title: 'Offline task' })

    beforeEach(async () => {
      const created = await queue.enqueueCreate({ projectId: 7, fields: { title: 'Offline task', priority: 1 } })
      pendingId = created.pendingId
      tempId = created.tempId
    })

    it('completing a pending row folds into the create, with no request', async () => {
      const result = await quickViewComplete(deps(), pendingId, row())
      expect(result).toEqual({ success: true, cached: true })
      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.getPending()).toHaveLength(1)
      expect((queue.getPending()[0] as CreateAction).done).toBe(true)
    })

    it('the undo of that completion takes it back out of the create', async () => {
      await quickViewComplete(deps(), pendingId, row())
      const result = await quickViewReopen(deps(), pendingId, row())
      expect(result).toMatchObject({ success: true, cancelledPending: true })
      expect((queue.getPending()[0] as CreateAction).done).toBeFalsy()
    })

    it('scheduling, clearing the date and editing a pending row change the create', async () => {
      await quickViewPatch(deps(), pendingId, { due_date: '2026-10-07T23:59:59.000Z' }, row())
      expect((queue.getPending()[0] as CreateAction).fields.due_date).toBe('2026-10-07T23:59:59.000Z')
      await quickViewPatch(deps(), pendingId, { due_date: null }, row())
      expect((queue.getPending()[0] as CreateAction).fields).not.toHaveProperty('due_date')
      await quickViewPatch(deps(), pendingId, { title: 'Renamed', description: '<p>x</p>' })
      expect((queue.getPending()[0] as CreateAction).fields).toMatchObject({ title: 'Renamed', description: '<p>x</p>', priority: 1 })
      expect(queue.getPending()).toHaveLength(1)
      expect(updateTask).not.toHaveBeenCalled()
    })

    it('a negative temp id works the same as the pending_ id', async () => {
      await quickViewPatch(deps(), tempId, { title: 'By temp id' })
      expect((queue.getPending()[0] as CreateAction).fields.title).toBe('By temp id')
    })

    it('once the create has replayed, the same row id reaches the real task', async () => {
      const [create] = queue.getPending()
      await queue.completeAction(create.id, { realId: 321 })

      const result = await quickViewComplete(deps(), pendingId, row())

      expect(result).toMatchObject({ success: true })
      expect(updateTask).toHaveBeenCalledWith(321, { done: true })
    })

    it('a row whose create is gone for good gets a clear error, not a request to a bogus id', async () => {
      await queue.discardPending([queue.getPending()[0].id])
      const result = await quickViewComplete(deps(), pendingId, row())
      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/no longer waiting/) })
      expect(updateTask).not.toHaveBeenCalled()
    })
  })

  describe('quickViewPatch', () => {
    it('sends only the patch', async () => {
      await quickViewPatch(deps(), 5, { due_date: '2026-10-07T23:59:59.000Z' }, { id: 5, title: 'T', priority: 9 })
      expect(updateTask).toHaveBeenCalledWith(5, { due_date: '2026-10-07T23:59:59.000Z' })
    })

    it('queues the same patch offline, labelled with the task title', async () => {
      updateTask.mockResolvedValue(err('Request timed out (10s)'))
      const result = await quickViewPatch(deps(), 5, { due_date: null }, { id: 5, title: 'Call mum' })
      expect(result).toEqual({ success: true, cached: true })
      expect(queue.snapshot().pending.map((p) => p.summary)).toEqual(['Remove the due date from "Call mum"'])
    })

    it('returns a rejection as is', async () => {
      updateTask.mockResolvedValue(err('validation failed', 422))
      expect(await quickViewPatch(deps(), 5, { title: '' })).toMatchObject({ success: false, error: 'validation failed' })
      expect(queue.counts().pending).toBe(0)
    })
  })

  // F1: a newer change must not be sent around an older one that still waits in the queue, or the
  // replay later sends the older one on top of it.
  describe('changes made while others wait for the same task', () => {
    it('quickViewPatch joins the queue instead of overtaking the waiting change', async () => {
      updateTask.mockResolvedValueOnce(err('net::ERR_INTERNET_DISCONNECTED'))
      await quickViewPatch(deps(), 5, { title: 'EDIT1' }, { id: 5, title: 'T' })
      updateTask.mockClear()

      const result = await quickViewPatch(deps(), 5, { title: 'EDIT2' }, { id: 5, title: 'T' })

      expect(result).toEqual({ success: true, cached: true })
      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.getPending()).toMatchObject([{ type: 'update', taskId: 5, patch: { title: 'EDIT2' } }])
    })

    it('quickViewComplete completes through the queue while a change for the task is waiting', async () => {
      await queue.enqueueUpdate(5, { title: 'Edited offline' }, { title: 'T' })

      const result = await quickViewComplete(deps(), 5, { id: 5, title: 'T' })

      expect(result).toEqual({ success: true, cached: true })
      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.getPending()).toMatchObject([{ type: 'update', taskId: 5, patch: { title: 'Edited offline', done: true } }])
    })

    it('a subtask with a waiting change is completed through the queue, and a refused parent takes that back out', async () => {
      await queue.enqueueUpdate(2, { title: 'Sub edited' })
      updateTask.mockImplementation(async (id: number) => (id === 1 ? err('validation failed', 422) : ok()))
      const parent = { id: 1, title: 'P', related_tasks: { subtask: [{ id: 2, title: 'a', done: false }] } }

      const result = await quickViewComplete(deps(), 1, parent)

      expect(result).toMatchObject({ success: false, error: 'validation failed' })
      expect(updateTask.mock.calls).toEqual([[1, { done: true }]])
      // The completion folded into the waiting edit and was cancelled again; the edit itself stays.
      expect(queue.getPending()).toMatchObject([{ type: 'update', taskId: 2, patch: { title: 'Sub edited' } }])
    })

    it('quickViewReopen queues the reopen behind a waiting change that is not a completion', async () => {
      await queue.enqueueUpdate(5, { title: 'Edited offline' })

      const result = await quickViewReopen(deps(), 5, { id: 5, title: 'T' })

      expect(result).toMatchObject({ success: true, cached: true })
      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.getPending()).toMatchObject([{ patch: { title: 'Edited offline', done: false } }])
    })

    it('a request still on the wire is not overtaken: when it fails, the next change queues behind it', async () => {
      let fail: (value: ApiResult<unknown>) => void = () => undefined
      updateTask.mockImplementationOnce(() => new Promise((resolve) => { fail = resolve }))

      const first = quickViewPatch(deps(), 5, { title: 'EDIT1' }, { id: 5 })
      const second = quickViewPatch(deps(), 5, { title: 'EDIT2' }, { id: 5 })
      await Promise.resolve()
      expect(updateTask).toHaveBeenCalledTimes(1)
      fail(err('Request timed out (10s)'))
      await Promise.all([first, second])

      expect(updateTask).toHaveBeenCalledTimes(1)
      expect(queue.getPending()).toMatchObject([{ type: 'update', taskId: 5, patch: { title: 'EDIT2' } }])
    })

    it('asks for a replay when a request got through while changes for other tasks wait', async () => {
      await queue.enqueueUpdate(9, { title: 'Waiting' })
      const requestReplay = vi.fn()

      await quickViewPatch({ ...deps(), requestReplay }, 5, { title: 'Fine' })

      expect(requestReplay).toHaveBeenCalledTimes(1)
    })
  })
})
