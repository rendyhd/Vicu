import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addLabelOrQueue,
  createTaskOrQueue,
  deleteTaskOrQueue,
  removeLabelOrQueue,
  sendTaskPatch,
} from '../offline-mutations'
import { ApiError } from '../mutation-errors'
import { useOfflineStore } from '@/stores/offline-store'
import { NULL_DATE } from '../constants'

const ok = (data: unknown = {}) => ({ success: true as const, data })
const fail = (error: string, statusCode?: number) => ({ success: false as const, error, statusCode })
const queued = (extra: Record<string, unknown> = {}) => ({ success: true as const, data: { actionId: 'a1', taskId: 5, folded: false, ...extra } })

describe('mutation helpers with the offline queue (D-SYNC-6, decision 4)', () => {
  let updateTask: ReturnType<typeof vi.fn>
  let deleteTask: ReturnType<typeof vi.fn>
  let createTask: ReturnType<typeof vi.fn>
  let addLabelToTask: ReturnType<typeof vi.fn>
  let removeLabelFromTask: ReturnType<typeof vi.fn>
  let queue: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    updateTask = vi.fn(async () => ok({ id: 5 }))
    deleteTask = vi.fn(async () => ok())
    createTask = vi.fn(async () => ok({ id: 100, title: 'Made' }))
    addLabelToTask = vi.fn(async () => ok())
    removeLabelFromTask = vi.fn(async () => ok())
    queue = {
      enqueueUpdate: vi.fn(async () => queued()),
      enqueueDelete: vi.fn(async () => queued()),
      enqueueAddLabel: vi.fn(async () => queued()),
      enqueueRemoveLabel: vi.fn(async () => queued()),
      enqueueCreate: vi.fn(async () => ({ success: true, data: { actionId: 'c1', tempId: -4, pendingId: 'pending_c1' } })),
    }
    vi.stubGlobal('window', { api: { updateTask, deleteTask, createTask, addLabelToTask, removeLabelFromTask, offlineQueue: queue } })
    useOfflineStore.setState({ counts: { pending: 0, failed: 0 } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The main process decides whether a change to an existing task is sent or queued (the write
  // gate, src/main/offline/task-writes.ts): the window asks with `{ queue: true }` and gets either
  // the server's answer or `{ success: true, queued: true }`.
  const queuedReply = { success: true as const, queued: true as const, data: null }

  describe('sendTaskPatch', () => {
    it('asks for the change to be sent, or queued, and reports the server task when it was sent', async () => {
      const result = await sendTaskPatch(5, { priority: 2 }, 'Pay rent')

      expect(updateTask).toHaveBeenCalledWith(5, { priority: 2 }, { queue: true, title: 'Pay rent' })
      expect(queue.enqueueUpdate).not.toHaveBeenCalled()
      expect(result).toEqual({ queued: false, task: { id: 5 } })
    })

    it('reports a queued change (the server was unreachable, or changes for the task were waiting) without a task', async () => {
      updateTask.mockResolvedValueOnce(queuedReply)

      const result = await sendTaskPatch(5, { priority: 2 }, 'Pay rent')

      expect(result).toEqual({ queued: true, task: null })
      // Queueing happened in the main process; the window does not queue it a second time.
      expect(queue.enqueueUpdate).not.toHaveBeenCalled()
    })

    it('leaves the title out of the options when there is none', async () => {
      await sendTaskPatch(5, { priority: 2 })
      expect(updateTask).toHaveBeenCalledWith(5, { priority: 2 }, { queue: true })
    })

    it.each([
      ['a validation error', fail('Invalid due date', 422)],
      ['a missing task', fail('Not found', 404)],
      ['a conflict', fail('Conflict', 409)],
      ['an expired session', fail('Session expired', 401)],
      ['a permission error', fail('Forbidden', 403)],
      ['an invalid token', fail('API token is invalid')],
      ['a queue that could not take the change', fail('Could not save offline: disk full', 502)],
    ])('throws on %s so the cache rolls back and the user sees why', async (_name, failure) => {
      updateTask.mockResolvedValueOnce(failure)

      await expect(sendTaskPatch(5, { priority: 2 }, 'x')).rejects.toBeInstanceOf(ApiError)
      expect(queue.enqueueUpdate).not.toHaveBeenCalled()
    })

    it('keeps the status code on the error it throws', async () => {
      updateTask.mockResolvedValueOnce(fail('Invalid due date', 422))
      await expect(sendTaskPatch(5, { priority: 2 })).rejects.toMatchObject({ statusCode: 422, message: 'Invalid due date' })
    })

    it('goes straight to the queue for a task that only exists as a pending create', async () => {
      const result = await sendTaskPatch(-4, { title: 'Better title' }, 'Draft')

      expect(updateTask).not.toHaveBeenCalled()
      expect(queue.enqueueUpdate).toHaveBeenCalledWith(-4, { title: 'Better title' }, { title: 'Draft' })
      expect(result.queued).toBe(true)
    })

    it('throws when the queue itself cannot take a change to a pending create', async () => {
      queue.enqueueUpdate.mockResolvedValueOnce({ success: false, error: 'disk full' })

      await expect(sendTaskPatch(-4, { priority: 2 })).rejects.toThrow(/disk full/)
    })
  })

  describe('deleteTaskOrQueue', () => {
    it('deletes online', async () => {
      expect(await deleteTaskOrQueue(5, 'x')).toEqual({ queued: false })
      expect(deleteTask).toHaveBeenCalledWith(5, { queue: true, title: 'x' })
      expect(queue.enqueueDelete).not.toHaveBeenCalled()
    })

    it('reports a delete the main process queued', async () => {
      deleteTask.mockResolvedValueOnce(queuedReply)
      expect(await deleteTaskOrQueue(5, 'Old task')).toEqual({ queued: true })
      expect(queue.enqueueDelete).not.toHaveBeenCalled()
    })

    it('drops a pending create from the queue instead of sending a delete', async () => {
      expect(await deleteTaskOrQueue(-4, 'Never sent')).toEqual({ queued: true })
      expect(deleteTask).not.toHaveBeenCalled()
      expect(queue.enqueueDelete).toHaveBeenCalledWith(-4, { title: 'Never sent' })
    })

    it('throws on a refusal', async () => {
      deleteTask.mockResolvedValueOnce(fail('Forbidden', 403))
      await expect(deleteTaskOrQueue(5)).rejects.toBeInstanceOf(ApiError)
    })
  })

  describe('labels', () => {
    it('asks for an add to be sent or queued, with the label title for the queue', async () => {
      expect(await addLabelOrQueue(5, { id: 3, title: 'home' }, 'Pay rent')).toEqual({ queued: false })
      expect(addLabelToTask).toHaveBeenCalledWith(5, 3, { queue: true, title: 'Pay rent', labelTitle: 'home' })
    })

    it('reports an add the main process queued', async () => {
      addLabelToTask.mockResolvedValueOnce(queuedReply)
      expect(await addLabelOrQueue(5, { id: 3, title: 'home' }, 'Pay rent')).toEqual({ queued: true })
      expect(queue.enqueueAddLabel).not.toHaveBeenCalled()
    })

    it('adds a label to a pending create through the queue', async () => {
      await addLabelOrQueue(-4, { id: 3 })
      expect(addLabelToTask).not.toHaveBeenCalled()
      expect(queue.enqueueAddLabel).toHaveBeenCalledWith(-4, { id: 3 }, {})
    })

    it('asks for a removal to be sent or queued and reports a queued one', async () => {
      expect(await removeLabelOrQueue(5, 3, 'Pay rent')).toEqual({ queued: false })
      expect(removeLabelFromTask).toHaveBeenCalledWith(5, 3, { queue: true, title: 'Pay rent' })

      removeLabelFromTask.mockResolvedValueOnce(queuedReply)
      expect(await removeLabelOrQueue(5, 3, 'Pay rent')).toEqual({ queued: true })
      expect(queue.enqueueRemoveLabel).not.toHaveBeenCalled()
    })

    it('removes a label from a pending create through the queue', async () => {
      await removeLabelOrQueue(-4, 3)
      expect(removeLabelFromTask).not.toHaveBeenCalled()
      expect(queue.enqueueRemoveLabel).toHaveBeenCalledWith(-4, 3, {})
    })

    it('does not queue a label the server rejected', async () => {
      addLabelToTask.mockResolvedValueOnce(fail('Label not found', 404))
      await expect(addLabelOrQueue(5, { id: 3 })).rejects.toBeInstanceOf(ApiError)
      expect(queue.enqueueAddLabel).not.toHaveBeenCalled()
    })
  })

  describe('createTaskOrQueue', () => {
    it('returns the created task online', async () => {
      const result = await createTaskOrQueue(7, { title: 'Made' })
      expect(result).toEqual({ queued: false, task: { id: 100, title: 'Made' } })
      expect(queue.enqueueCreate).not.toHaveBeenCalled()
    })

    it('queues a create when the request provably never reached the server, and returns a task with the temp id', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_NAME_NOT_RESOLVED'))

      const result = await createTaskOrQueue(7, { title: 'Buy milk', priority: 2, due_date: '2026-10-08T21:59:59Z' }, {
        labels: [{ id: 3 }, { title: 'errand' }],
      })

      expect(queue.enqueueCreate).toHaveBeenCalledWith({
        projectId: 7,
        fields: { title: 'Buy milk', priority: 2, due_date: '2026-10-08T21:59:59Z' },
        done: false,
        labels: [{ id: 3 }, { title: 'errand' }],
        images: undefined,
      })
      expect(result.queued).toBe(true)
      expect(result.task).toMatchObject({ id: -4, title: 'Buy milk', project_id: 7, priority: 2, done: false })
      expect(result.task.due_date).toBe('2026-10-08T21:59:59Z')
    })

    it('queues a create that was asked to start completed, as done, not as a field', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_INTERNET_DISCONNECTED'))
      const result = await createTaskOrQueue(7, { title: 'Already done', done: true })
      expect(queue.enqueueCreate).toHaveBeenCalledWith(expect.objectContaining({ fields: { title: 'Already done' }, done: true }))
      expect(result.task.done).toBe(true)
    })

    it('does not queue a create that may have been applied (a timeout or a 500): replaying could duplicate it', async () => {
      createTask.mockResolvedValueOnce(fail('Request timed out'))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toThrow('may already have been created')
      createTask.mockResolvedValueOnce(fail('Internal Server Error', 500))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toBeInstanceOf(ApiError)
      expect(queue.enqueueCreate).not.toHaveBeenCalled()
    })

    it('tells the user a timed out create may already exist (F7)', async () => {
      createTask.mockResolvedValueOnce(fail('Request timed out (10s)'))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toThrow(
        "The server didn't answer in time. The task may already have been created; check before retrying.",
      )
    })

    it('keeps the status of a 500 on the warning and marks it as one that must be shown as worded', async () => {
      createTask.mockResolvedValueOnce(fail('Internal Server Error', 500))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toMatchObject({
        statusCode: 500,
        mayExist: true,
        message: expect.stringContaining('may already have been created'),
      })
    })

    it('does not mark a refusal as a possible create', async () => {
      createTask.mockResolvedValueOnce(fail('title too long', 422))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toMatchObject({ statusCode: 422, mayExist: false, message: 'title too long' })
    })

    it('queues a create after a gateway error', async () => {
      createTask.mockResolvedValueOnce(fail('Bad Gateway', 502))
      const result = await createTaskOrQueue(7, { title: 'x' })
      expect(result.queued).toBe(true)
    })

    it('does not queue a rejected create', async () => {
      createTask.mockResolvedValueOnce(fail('title too long', 422))
      await expect(createTaskOrQueue(7, { title: 'x' })).rejects.toMatchObject({ statusCode: 422 })
    })

    it('shows the labels it was given on the pending task', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_INTERNET_DISCONNECTED'))
      const home = { id: 3, title: 'home', hex_color: '', created: '', updated: '' }
      const result = await createTaskOrQueue(7, { title: 'x' }, { labels: [{ id: 3 }], displayLabels: [home] })
      expect(result.task.labels).toEqual([home])
    })

    it('queues the description without placeholders for images that were never uploaded', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_INTERNET_DISCONNECTED'))
      const result = await createTaskOrQueue(7, { title: 'x', description: 'a [[image-pending:u1]]' }, { queuedDescription: 'a ' })
      expect(queue.enqueueCreate).toHaveBeenCalledWith(expect.objectContaining({ fields: { title: 'x', description: 'a ' } }))
      expect(result.task.description).toBe('a ')
    })

    it('queues no description at all when stripping leaves nothing', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_INTERNET_DISCONNECTED'))
      await createTaskOrQueue(7, { title: 'x', description: '[[image-pending:u1]]' }, { queuedDescription: '' })
      expect(queue.enqueueCreate).toHaveBeenCalledWith(expect.objectContaining({ fields: { title: 'x' } }))
    })

    it('keeps the null date for a task without a due date', async () => {
      createTask.mockResolvedValueOnce(fail('net::ERR_INTERNET_DISCONNECTED'))
      const result = await createTaskOrQueue(7, { title: 'x' })
      expect(result.task.due_date).toBe(NULL_DATE)
    })
  })
})
