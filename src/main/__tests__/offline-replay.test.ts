import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { MAX_UNKNOWN_ATTEMPTS, createReplayRunner, replayQueue, type ReplayApi } from '../offline/replay'
import type { ApiResult } from '../api-result'

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<never> => ({ success: false, error, statusCode })

type Script = Partial<Record<keyof ReplayApi, (...args: any[]) => Promise<ApiResult<any>> | ApiResult<any>>>

/** A fake Vikunja that records every request and answers from a script; defaults succeed. */
function fakeApi(script: Script = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = []
  let nextTaskId = 1000
  let nextLabelId = 500
  const labels = [{ id: 11, title: 'Home' }]
  const attachments: Array<{ id: number }> = []
  const descriptions = new Map<number, string>()

  const record = async <T>(op: keyof ReplayApi, args: unknown[], fallback: () => ApiResult<T>): Promise<ApiResult<T>> => {
    calls.push({ op, args })
    const custom = script[op]
    return (custom ? await custom(...args) : fallback()) as ApiResult<T>
  }

  const api: ReplayApi = {
    createTask: (projectId, payload) =>
      record('createTask', [projectId, payload], () => {
        const id = nextTaskId++
        descriptions.set(id, typeof payload.description === 'string' ? payload.description : '')
        return ok({ id })
      }),
    updateTask: (id, patch) =>
      record('updateTask', [id, patch], () => {
        if (typeof patch.description === 'string') descriptions.set(id, patch.description)
        return ok({ id })
      }),
    deleteTask: (id) => record('deleteTask', [id], () => ok(undefined)),
    addLabelToTask: (taskId, labelId) => record('addLabelToTask', [taskId, labelId], () => ok(undefined)),
    removeLabelFromTask: (taskId, labelId) => record('removeLabelFromTask', [taskId, labelId], () => ok(undefined)),
    fetchLabels: () => record('fetchLabels', [], () => ok(labels.slice())),
    createLabel: (label) =>
      record('createLabel', [label], () => {
        const created = { id: nextLabelId++, title: label.title as string }
        labels.push(created)
        return ok(created)
      }),
    uploadTaskAttachment: (taskId, bytes, name, mime) =>
      record('uploadTaskAttachment', [taskId, bytes.length, name, mime], () => {
        attachments.push({ id: 900 + attachments.length })
        return ok({})
      }),
    fetchTaskAttachments: (taskId) => record('fetchTaskAttachments', [taskId], () => ok(attachments.slice())),
    fetchTaskById: (taskId) => record('fetchTaskById', [taskId], () => ok({ id: taskId, description: descriptions.get(taskId) ?? '' })),
    findRecentCreate: (projectId, fields, since) => record('findRecentCreate', [projectId, fields.title, since], () => ok(null)),
  }
  return { api, calls, ops: () => calls.map((c) => c.op), descriptions }
}

describe('replayQueue', () => {
  let dir: string
  let queue: OfflineQueue
  let idCounter = 0
  let warn: ReturnType<typeof vi.spyOn>

  const fresh = () => {
    const q = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++idCounter}`,
    })
    q.load()
    return q
  }

  /** Replace the queue with hand-written actions, as a crashed or older build could leave them. */
  const seed = (actions: unknown[], lastTempId = -9) => {
    writeFileSync(join(dir, 'offline-queue.json'), JSON.stringify({ version: 1, actions, failed: [], resolved: {}, lastTempId }))
    return fresh()
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-replay-'))
    idCounter = 0
    queue = fresh()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does nothing for an empty queue', async () => {
    const { api, calls } = fakeApi()
    const result = await replayQueue(queue, api)
    expect(result).toMatchObject({ applied: 0, failed: 0, stopped: null, counts: { pending: 0, failed: 0 } })
    expect(calls).toHaveLength(0)
  })

  describe('queued changes are replayed as patches (D-SYNC-2)', () => {
    it('sends only { done } for a completion, and only { due_date } for a schedule', async () => {
      await queue.enqueueComplete(5, true, { title: 'A' })
      await queue.enqueueUpdate(6, { due_date: '2026-10-07T23:59:59.000Z' })
      await queue.enqueueUpdate(7, { due_date: null })
      const { api, calls } = fakeApi()

      const result = await replayQueue(queue, api)

      expect(calls).toEqual([
        { op: 'updateTask', args: [5, { done: true }] },
        { op: 'updateTask', args: [6, { due_date: '2026-10-07T23:59:59.000Z' }] },
        { op: 'updateTask', args: [7, { due_date: null }] },
      ])
      expect(result).toMatchObject({ applied: 3, stopped: null })
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('replays in the order the changes were made', async () => {
      await queue.enqueueUpdate(1, { title: 'one' })
      await queue.enqueueDelete(2)
      await queue.enqueueUpdate(3, { title: 'three' })
      const { api, calls } = fakeApi()
      await replayQueue(queue, api)
      expect(calls.map((c) => [c.op, c.args[0]])).toEqual([
        ['updateTask', 1],
        ['deleteTask', 2],
        ['updateTask', 3],
      ])
    })
  })

  describe('failures that keep the queue and stop the replay (D-SYNC-1)', () => {
    const keepsEverything = async (failure: ApiResult<never>, stopped: string) => {
      const a = await queue.enqueueUpdate(1, { title: 'a' })
      await queue.enqueueUpdate(2, { title: 'b' })
      const { api, calls } = fakeApi({ updateTask: () => failure })

      const result = await replayQueue(queue, api)

      expect(result).toMatchObject({ applied: 0, failed: 0, stopped })
      expect(calls).toHaveLength(1) // stopped at the first failure, preserving order
      expect(queue.counts()).toEqual({ pending: 2, failed: 0 })
      expect(queue.getPending()[0].id).toBe(a.actionId)
      expect(queue.getPending()[0].attempts).toBe(0)
      return result
    }

    it('network errors', async () => {
      const result = await keepsEverything(err('net::ERR_INTERNET_DISCONNECTED'), 'network')
      expect(result.error).toContain('ERR_INTERNET_DISCONNECTED')
    })

    it('timeouts', () => keepsEverything(err('Request timed out (10s)'), 'network'))
    it('500 Server error', () => keepsEverything(err('Server error — Vikunja may be experiencing issues.', 500), 'server'))
    it('503 during maintenance', () => keepsEverything(err('HTTP 503', 503), 'server'))
    it('429 rate limiting', () => keepsEverything(err('HTTP 429', 429), 'rate-limit'))

    it('an expired session keeps the queue and raises an auth problem', async () => {
      await keepsEverything(err('Session expired. Please sign in again.'), 'auth')
      expect(queue.snapshot().authProblem).toMatchObject({ error: 'Session expired. Please sign in again.' })
    })

    it('an invalid token (401) keeps the queue and raises an auth problem', async () => {
      await keepsEverything(err('API token is invalid or expired. Check Settings or generate a new token in Vikunja.', 401), 'auth')
      expect(queue.snapshot().authProblem).not.toBeNull()
    })

    it('403 keeps the queue as an auth problem', () => keepsEverything(err('API token lacks permission.', 403), 'auth'))

    it('the auth problem clears after a replay that gets through', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      await replayQueue(queue, fakeApi({ updateTask: () => err('API token is invalid', 401) }).api)
      expect(queue.snapshot().authProblem).not.toBeNull()

      await replayQueue(queue, fakeApi().api)
      expect(queue.snapshot().authProblem).toBeNull()
      expect(queue.counts().pending).toBe(0)
    })
  })

  describe('failures that drop the action into the failed log', () => {
    it.each([
      [400, 'rejected'],
      [422, 'rejected'],
      [409, 'conflict'],
    ] as const)('HTTP %i is recorded with the error and a summary, and the queue carries on', async (status, reason) => {
      await queue.enqueueComplete(1, true, { title: 'Pay rent' })
      await queue.enqueueUpdate(2, { title: 'next' })
      const { api, calls } = fakeApi({ updateTask: (id: number) => (id === 1 ? err('validation failed', status) : ok({})) })

      const result = await replayQueue(queue, api)

      expect(calls.map((c) => c.args[0])).toEqual([1, 2])
      expect(result).toMatchObject({ applied: 1, failed: 1, stopped: null })
      expect(queue.snapshot().failed).toMatchObject([{ summary: 'Complete "Pay rent"', error: 'validation failed', statusCode: status, reason }])
      expect(queue.counts()).toEqual({ pending: 0, failed: 1 })
    })

    it('404 on an update means the task is gone: dropped and visible', async () => {
      await queue.enqueueUpdate(1, { title: 'x' }, { title: 'Old task' })
      const { api } = fakeApi({ updateTask: () => err('Not found — the task or project may have been deleted.', 404) })
      await replayQueue(queue, api)
      expect(queue.snapshot().failed).toMatchObject([{ reason: 'task-gone', statusCode: 404 }])
    })

    it('404 on a delete means it is already gone: done, nothing to show', async () => {
      await queue.enqueueDelete(1)
      const { api } = fakeApi({ deleteTask: () => err('Not found', 404) })
      const result = await replayQueue(queue, api)
      expect(result).toMatchObject({ applied: 1, failed: 0 })
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('409 on adding a label that is already on the task counts as done', async () => {
      await queue.enqueueAddLabel(5, { id: 3 })
      const { api } = fakeApi({ addLabelToTask: () => err('HTTP 409', 409) })
      await replayQueue(queue, api)
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('an exception from the API layer is a failure of that request, not a crashed replay', async () => {
      const a = await queue.enqueueUpdate(1, { title: 'a' })
      const { api } = fakeApi({
        updateTask: () => {
          throw new Error('boom')
        },
      })

      const result = await replayQueue(queue, api)

      expect(result).toMatchObject({ stopped: 'unknown', error: 'boom' })
      expect(queue.getPending()[0]).toMatchObject({ id: a.actionId, attempts: 1 })
    })

    it('an error nobody has a rule for stops the replay, is counted, and surfaces after several replays', async () => {
      const a = await queue.enqueueUpdate(1, { title: 'a' })
      await queue.enqueueUpdate(2, { title: 'b' })
      const { api, calls } = fakeApi({ updateTask: (id: number) => (id === 1 ? err('HTTP 418', 418) : ok({})) })

      for (let i = 1; i < MAX_UNKNOWN_ATTEMPTS; i++) {
        const result = await replayQueue(queue, api)
        expect(result.stopped).toBe('unknown')
        expect(queue.getPending()[0]).toMatchObject({ id: a.actionId, attempts: i })
      }
      expect(calls.every((c) => c.args[0] === 1)).toBe(true) // the second action was never reached

      const last = await replayQueue(queue, api)
      expect(last).toMatchObject({ stopped: null, failed: 1, applied: 1 }) // gave up on #1, sent #2
      expect(queue.snapshot().failed).toMatchObject([{ id: a.actionId, reason: 'gave-up' }])
    })
  })

  describe('creates keep every field', () => {
    it('sends title, description, due date, priority, recurrence and reminders in one create', async () => {
      const reminders = [{ reminder: '2026-10-07T09:00:00Z' }]
      await queue.enqueueCreate({
        projectId: 7,
        fields: {
          title: 'Water plants', description: '<p>x</p>', due_date: '2026-10-08T14:30:00.000Z',
          priority: 3, repeat_after: 604800, repeat_mode: 0, reminders,
        },
      })
      const { api, calls } = fakeApi()
      await replayQueue(queue, api)
      expect(calls).toEqual([
        {
          op: 'createTask',
          args: [7, {
            title: 'Water plants', description: '<p>x</p>', due_date: '2026-10-08T14:30:00.000Z',
            priority: 3, repeat_after: 604800, repeat_mode: 0, reminders,
          }],
        },
      ])
    })

    it('completes a task that was completed offline with an update right after the create', async () => {
      const { pendingId } = await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' } })
      await queue.enqueueComplete(pendingId, true)
      const { api, calls } = fakeApi()

      const result = await replayQueue(queue, api)

      expect(calls.map((c) => c.op)).toEqual(['createTask', 'updateTask'])
      expect(calls[1].args).toEqual([1000, { done: true }])
      expect(result.idMap).toEqual({ '-1': 1000 })
    })

    it('an edit folded into a pending create is sent as part of the create, not as a second request', async () => {
      const { pendingId } = await queue.enqueueCreate({ projectId: 7, fields: { title: 'Draft' } })
      await queue.enqueueUpdate(pendingId, { title: 'Final', priority: 2 })
      const { api, calls } = fakeApi()
      await replayQueue(queue, api)
      expect(calls).toEqual([{ op: 'createTask', args: [7, { title: 'Final', priority: 2 }] }])
    })

    it('a task created and deleted offline never reaches the server', async () => {
      const { tempId } = await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' } })
      await queue.enqueueDelete(tempId)
      const { api, calls } = fakeApi()
      await replayQueue(queue, api)
      expect(calls).toHaveLength(0)
    })
  })

  describe('a create whose earlier attempt may have been applied', () => {
    it('is not sent blindly: it looks for the task first, and adopts it instead of creating a duplicate', async () => {
      const { tempId } = await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' }, labels: [{ id: 3 }] })
      let calls = 0
      const harness = fakeApi({
        createTask: () => (++calls === 1 ? err('Request timed out (10s)') : ok({ id: 1000 })),
        // the first attempt did reach the server and created task 777
        findRecentCreate: () => ok({ id: 777 }),
      })

      const first = await replayQueue(queue, harness.api)
      expect(first.stopped).toBe('network')
      expect(queue.getPending()[0]).toMatchObject({ type: 'create', maybeSent: { projectId: 7, fields: { title: 'Pack' } } })

      const second = await replayQueue(queue, harness.api)

      expect(harness.ops()).toEqual(['createTask', 'findRecentCreate', 'addLabelToTask'])
      expect(harness.calls[2].args).toEqual([777, 3]) // the label follows the task that already exists
      expect(second).toMatchObject({ applied: 2, stopped: null, idMap: { [String(tempId)]: 777 } })
    })

    it('looks for what the unconfirmed attempt sent, then applies the edits made since to the task it adopts', async () => {
      const { pendingId } = await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack', priority: 1, due_date: '2026-10-08T14:30:00.000Z' } })
      let calls = 0
      const harness = fakeApi({
        createTask: () => (++calls === 1 ? err('Request timed out (10s)') : ok({ id: 1000 })),
        findRecentCreate: () => ok({ id: 777 }),
      })
      await replayQueue(queue, harness.api)

      // While offline again the user renames the pending task, raises its priority and clears its date.
      await queue.enqueueUpdate(pendingId, { title: 'Pack bags', priority: 2, due_date: null })
      const second = await replayQueue(queue, harness.api)

      expect(harness.calls.find((c) => c.op === 'findRecentCreate')?.args[1]).toBe('Pack') // the title that was sent
      expect(harness.calls.filter((c) => c.op === 'createTask')).toHaveLength(1)
      expect(harness.calls[harness.calls.length - 1]).toEqual({ op: 'updateTask', args: [777, { title: 'Pack bags', priority: 2, due_date: null }] })
      expect(second).toMatchObject({ stopped: null, idMap: { '-1': 777 } })
    })

    it('creates it when the lookup finds nothing', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' } })
      let calls = 0
      const harness = fakeApi({ createTask: () => (++calls === 1 ? err('socket hang up') : ok({ id: 1000 })) })

      await replayQueue(queue, harness.api)
      const second = await replayQueue(queue, harness.api)

      expect(harness.ops()).toEqual(['createTask', 'findRecentCreate', 'createTask'])
      expect(second.idMap).toEqual({ '-1': 1000 })
    })

    it('looks only for tasks created since the create was queued, in its project, with its title', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' } })
      const queuedAt = queue.getPending()[0].createdAt
      const harness = fakeApi({ createTask: () => err('Request timed out (10s)') })
      await replayQueue(queue, harness.api)
      await replayQueue(queue, harness.api)
      expect(harness.calls.find((c) => c.op === 'findRecentCreate')?.args).toEqual([7, 'Pack', queuedAt])
    })

    it('stays queued when the lookup itself fails', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' } })
      const harness = fakeApi({ createTask: () => err('Request timed out (10s)'), findRecentCreate: () => err('net::ERR_INTERNET_DISCONNECTED') })
      await replayQueue(queue, harness.api)
      const second = await replayQueue(queue, harness.api)
      expect(second.stopped).toBe('network')
      expect(harness.ops()).toEqual(['createTask', 'findRecentCreate'])
      expect(queue.counts().pending).toBe(1)
    })

    it('a failure that provably never reached the server does not trigger the lookup', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' } })
      let calls = 0
      const harness = fakeApi({ createTask: () => (++calls === 1 ? err('net::ERR_CONNECTION_REFUSED') : ok({ id: 1000 })) })
      await replayQueue(queue, harness.api)
      await replayQueue(queue, harness.api)
      expect(harness.ops()).toEqual(['createTask', 'createTask'])
    })
  })

  describe('temp ids are remapped across chained actions', () => {
    it('create, then label by id, label by title (existing and new), update and delete of another task', async () => {
      const { tempId, actionId } = await queue.enqueueCreate({
        projectId: 7,
        fields: { title: 'Pack' },
        labels: [{ id: 3 }, { title: 'home' }, { title: 'Travel' }],
      })
      // A change made while the create is being sent has to follow it.
      const { api, calls } = fakeApi({
        createTask: async () => {
          await queue.enqueueUpdate(tempId, { priority: 5 })
          return ok({ id: 321 })
        },
      })

      const result = await replayQueue(queue, api)

      expect(result.idMap).toEqual({ [String(tempId)]: 321 })
      expect(calls.map((c) => [c.op, ...c.args.slice(0, 2)])).toEqual([
        ['createTask', 7, { title: 'Pack' }],
        ['addLabelToTask', 321, 3],
        ['fetchLabels'],
        ['addLabelToTask', 321, 11], // "home" matched the existing label "Home"
        ['fetchLabels'],
        ['createLabel', { title: 'Travel' }],
        ['addLabelToTask', 321, 500],
        ['updateTask', 321, { priority: 5 }],
      ])
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
      expect(queue.resolveTaskRef(tempId)).toBe(321)
      expect(actionId).toBeTruthy()
    })

    it('a create that fails for good takes its follow-ups into the failed log and the rest still run', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'Pack' }, labels: [{ id: 3 }] })
      await queue.enqueueUpdate(50, { done: true })
      const { api, calls } = fakeApi({ createTask: () => err('project not found', 404) })

      const result = await replayQueue(queue, api)

      expect(calls.map((c) => c.op)).toEqual(['createTask', 'updateTask'])
      expect(result).toMatchObject({ applied: 1, failed: 2, stopped: null })
      expect(queue.snapshot().failed.map((f) => f.reason)).toEqual(['not-found', 'dependency-failed'])
    })

    it('a follow-up whose task was never created is failed, not sent to a negative id', async () => {
      const q = seed([
        { id: 'orphan', type: 'update', taskId: -4, patch: { done: true }, createdAt: 'x', attempts: 0 },
        { id: 'fine', type: 'update', taskId: 50, patch: { done: true }, createdAt: 'x', attempts: 0 },
      ])
      const { api, calls } = fakeApi()

      const result = await replayQueue(q, api)

      expect(calls.map((c) => c.args[0])).toEqual([50])
      expect(result).toMatchObject({ applied: 1, failed: 1 })
      expect(q.snapshot().failed).toMatchObject([{ id: 'orphan', reason: 'dependency-failed' }])
    })
  })

  describe('pasted images are uploaded after the create, then deleted (D-QE-1)', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])

    it('create, upload, token in the description, file removed', async () => {
      const { tempId } = await queue.enqueueCreate({
        projectId: 7,
        fields: { title: 'Screenshot', description: '<p>see image</p>' },
        images: [
          { name: 'a.png', mime: 'image/png', bytes: png },
          { name: 'b.png', mime: 'image/png', bytes: png },
        ],
      })
      const files = queue.getPending().filter((a) => a.type === 'upload-attachment').map((a) => (a as { file: string }).file)
      expect(files.every((f) => existsSync(join(dir, 'offline-attachments', f)))).toBe(true)
      const { api, ops, descriptions } = fakeApi()

      const result = await replayQueue(queue, api)

      // Strictly create first; each upload is followed by its own description edit.
      expect(ops()).toEqual([
        'createTask',
        'uploadTaskAttachment', 'fetchTaskAttachments', 'fetchTaskById', 'updateTask',
        'uploadTaskAttachment', 'fetchTaskAttachments', 'fetchTaskById', 'updateTask',
      ])
      expect(result).toMatchObject({ applied: 3, failed: 0 })
      expect(descriptions.get(1000)).toBe('<p>see image</p>\n[[image:900]]\n[[image:901]]')
      expect(files.some((f) => existsSync(join(dir, 'offline-attachments', f)))).toBe(false)
      expect(queue.resolveTaskRef(tempId)).toBe(1000)
    })

    it('a network failure after the upload does not upload the file a second time', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a.png', mime: 'image/png', bytes: png }] })
      let attachmentsFail = true
      const harness = fakeApi({
        fetchTaskAttachments: () => (attachmentsFail ? err('net::ERR_INTERNET_DISCONNECTED') : ok([{ id: 900 }])),
      })

      const first = await replayQueue(queue, harness.api)
      expect(first.stopped).toBe('network')
      expect(harness.ops()).toEqual(['createTask', 'uploadTaskAttachment', 'fetchTaskAttachments'])
      expect(queue.getPending()).toMatchObject([{ type: 'upload-attachment', uploaded: true, taskId: 1000 }])

      attachmentsFail = false
      const second = await replayQueue(queue, harness.api)
      expect(second).toMatchObject({ applied: 1, stopped: null })
      expect(harness.ops().filter((op) => op === 'uploadTaskAttachment')).toHaveLength(1)
      expect(harness.descriptions.get(1000)).toBe('[[image:900]]')
    })

    it('an upload without the inline-image flag is only uploaded, with no description edit', async () => {
      const file = await queue.files.save(png)
      const q = seed([
        { id: 'att', type: 'upload-attachment', taskId: 77, file, name: 'f.pdf', mime: 'application/pdf', createdAt: 'x', attempts: 0 },
      ])
      const { api, ops } = fakeApi()
      await replayQueue(q, api)
      expect(ops()).toEqual(['uploadTaskAttachment'])
      expect(existsSync(join(dir, 'offline-attachments', file))).toBe(false)
    })

    it('a missing image file is a failed action, not a stuck queue', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a.png', mime: 'image/png', bytes: png }] })
      const file = (queue.getPending()[1] as { file: string }).file
      rmSync(join(dir, 'offline-attachments', file))
      const { api } = fakeApi()

      const result = await replayQueue(queue, api)

      expect(result).toMatchObject({ applied: 1, failed: 1, stopped: null })
      expect(queue.snapshot().failed[0].error).toMatch(/could not be read/)
    })

    it('an upload the server says is too large (413) goes to the failed log and the queue carries on', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'big.png', mime: 'image/png', bytes: png }] })
      const file = (queue.getPending()[1] as { file: string }).file
      await queue.enqueueUpdate(5, { title: 'later' })
      const { api, ops } = fakeApi({ uploadTaskAttachment: () => err('HTTP 413', 413) })

      const result = await replayQueue(queue, api)

      // The create went out, the oversized upload failed for good, and the update behind it was sent.
      expect(result).toMatchObject({ stopped: null, applied: 2, failed: 1 })
      expect(queue.snapshot().failed).toMatchObject([{ reason: 'too-large', statusCode: 413 }])
      expect(queue.counts().pending).toBe(0)
      expect(ops()).toEqual(['createTask', 'uploadTaskAttachment', 'updateTask'])
      // The file stays so the user can retry after raising the limit or shrinking it.
      expect(existsSync(join(dir, 'offline-attachments', file))).toBe(true)
    })

    it('an upload rejected by the server keeps the file so the user can retry', async () => {
      await queue.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a.png', mime: 'image/png', bytes: png }] })
      const file = (queue.getPending()[1] as { file: string }).file
      const { api } = fakeApi({ uploadTaskAttachment: () => err('file too large', 400) })

      await replayQueue(queue, api)

      expect(queue.counts().failed).toBe(1)
      expect(existsSync(join(dir, 'offline-attachments', file))).toBe(true)
      // Retry after fixing the server limit: the whole thing replays from the failed log.
      await queue.retryFailed()
      const ok2 = fakeApi()
      await replayQueue(queue, ok2.api)
      expect(ok2.ops()).toContain('uploadTaskAttachment')
      expect(existsSync(join(dir, 'offline-attachments', file))).toBe(false)
    })
  })

  describe('cancellation while a replay runs (D-SYNC-4)', () => {
    /** An API whose first updateTask waits until the test lets it go. */
    const gated = () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      let started!: () => void
      const firstSent = new Promise<void>((resolve) => (started = resolve))
      let first = true
      const harness = fakeApi({
        updateTask: async () => {
          if (first) {
            first = false
            started()
            await gate
          }
          return ok({})
        },
      })
      return { ...harness, release, firstSent }
    }

    it('an action discarded while an earlier one is in flight is not sent afterwards', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      const b = await queue.enqueueUpdate(2, { title: 'b' })
      await queue.enqueueUpdate(3, { title: 'c' })
      const h = gated()

      const running = replayQueue(queue, h.api)
      await h.firstSent
      await queue.discardPending([b.actionId]) // the user undoes b while a is on the wire
      h.release()
      await running

      expect(h.calls.map((c) => c.args[0])).toEqual([1, 3])
      expect(queue.counts().pending).toBe(0)
    })

    it('a change folded into a queued action while an earlier one is in flight is sent merged', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      await queue.enqueueUpdate(2, { title: 'b' })
      const h = gated()

      const running = replayQueue(queue, h.api)
      await h.firstSent
      await queue.enqueueUpdate(2, { priority: 4 }) // folds into b, which has not been sent yet
      h.release()
      await running

      expect(h.calls).toEqual([
        { op: 'updateTask', args: [1, { title: 'a' }] },
        { op: 'updateTask', args: [2, { title: 'b', priority: 4 }] },
      ])
    })

    it('an undo of the change that is on the wire cannot cancel it: the opposite change follows', async () => {
      const first = await queue.enqueueComplete(1, true)
      const h = gated()

      const running = replayQueue(queue, h.api)
      await h.firstSent
      expect(await queue.cancelChange(1, ['done'])).toBe(false)
      await queue.enqueueComplete(1, false)
      h.release()
      await running

      expect(h.calls).toEqual([
        { op: 'updateTask', args: [1, { done: true }] },
        { op: 'updateTask', args: [1, { done: false }] },
      ])
      expect(first.actionId).toBeTruthy()
    })

    it('an action that was never queued behind it is picked up by the same run', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      const h = gated()
      const running = replayQueue(queue, h.api)
      await h.firstSent
      await queue.enqueueUpdate(9, { title: 'late' })
      h.release()
      await running
      expect(h.calls.map((c) => c.args[0])).toEqual([1, 9])
    })

    it('an action is never in flight twice: concurrent replays share one run', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      await queue.enqueueUpdate(2, { title: 'b' })
      const h = gated()
      const replay = createReplayRunner(() => replayQueue(queue, h.api))

      const one = replay()
      await h.firstSent
      const two = replay() // asked again while the first is on the wire
      expect(two).toBe(one)
      h.release()
      await Promise.all([one, two])

      expect(h.calls.map((c) => c.args[0])).toEqual([1, 2])
    })

    it('the runner starts a fresh run once the previous one is done', async () => {
      const run = vi.fn(async () => ({ applied: 0, failed: 0, stopped: null, idMap: {}, counts: { pending: 0, failed: 0 } }))
      const replay = createReplayRunner(run)
      await replay()
      await replay()
      expect(run).toHaveBeenCalledTimes(2)
    })

    it('reports that it is replaying while it runs', async () => {
      await queue.enqueueUpdate(1, { title: 'a' })
      const h = gated()
      const running = replayQueue(queue, h.api)
      await h.firstSent
      expect(queue.snapshot().replaying).toBe(true)
      h.release()
      await running
      expect(queue.snapshot().replaying).toBe(false)
    })
  })
})
