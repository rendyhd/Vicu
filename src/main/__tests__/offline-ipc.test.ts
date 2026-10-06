import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { parseQueuedImages, parseQueuedLabels } from '../offline/parse-input'

const hoisted = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  queue: null as unknown,
  replay: null as unknown,
}))

vi.mock('../secure-ipc', () => ({
  handleTrusted: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => {
    hoisted.handlers.set(channel, listener)
  },
}))
vi.mock('../offline/service', () => ({
  getOfflineQueue: () => hoisted.queue,
}))
vi.mock('../sync', () => ({
  replayPendingActions: (...args: unknown[]) => (hoisted.replay as (...a: unknown[]) => unknown)(...args),
}))

import { registerOfflineQueueIpc } from '../offline/ipc'

type Result<T> = { success: true; data: T } | { success: false; error: string }

describe('offline queue IPC (the contract for the main window)', () => {
  let dir: string
  let queue: OfflineQueue
  let idCounter: number
  const call = async <T = unknown>(channel: string, ...args: unknown[]): Promise<Result<T>> => {
    const handler = hoisted.handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return (await handler({}, ...args)) as Result<T>
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-ipc-'))
    idCounter = 0
    queue = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++idCounter}`,
    })
    queue.load()
    hoisted.queue = queue
    hoisted.replay = vi.fn(async () => null)
    hoisted.handlers.clear()
    registerOfflineQueueIpc()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers every channel the preload calls', () => {
    expect([...hoisted.handlers.keys()].sort()).toEqual([
      'offline-queue:cancel-change',
      'offline-queue:discard-failed',
      'offline-queue:discard-pending',
      'offline-queue:enqueue-add-label',
      'offline-queue:enqueue-complete',
      'offline-queue:enqueue-create',
      'offline-queue:enqueue-delete',
      'offline-queue:enqueue-remove-label',
      'offline-queue:enqueue-update',
      'offline-queue:replay-now',
      'offline-queue:retry-failed',
      'offline-queue:snapshot',
    ])
  })

  it('enqueue-update stores a patch and reports whether it folded', async () => {
    const first = await call<{ actionId: string; taskId: number; folded: boolean }>('offline-queue:enqueue-update', 5, { title: 'a' }, { title: 'Old title' })
    expect(first).toMatchObject({ success: true, data: { taskId: 5, folded: false } })
    const second = await call<{ folded: boolean }>('offline-queue:enqueue-update', 5, { priority: 2 })
    expect(second).toMatchObject({ success: true, data: { folded: true } })
    expect(queue.getPending()).toMatchObject([{ patch: { title: 'a', priority: 2 }, title: 'Old title' }])
  })

  it('enqueue-complete and cancel-change round trip', async () => {
    await call('offline-queue:enqueue-complete', 5, true)
    expect(queue.getPending()).toMatchObject([{ patch: { done: true } }])
    expect(await call('offline-queue:cancel-change', 5, ['done'])).toEqual({ success: true, data: true })
    expect(queue.counts().pending).toBe(0)
  })

  it('enqueue-create returns the temp id and the pending_ id, and keeps labels and images', async () => {
    const result = await call<{ actionId: string; tempId: number; pendingId: string }>('offline-queue:enqueue-create', {
      projectId: 7,
      fields: { title: 'Pack', priority: 2 },
      done: false,
      labels: [{ id: 3 }, { title: 'Travel' }],
      images: [{ name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
    })
    expect(result).toMatchObject({ success: true, data: { tempId: -1, pendingId: expect.stringMatching(/^pending_/) } })
    expect(queue.getPending().map((a) => a.type)).toEqual(['create', 'add-label', 'add-label', 'upload-attachment'])
  })

  it('a task that only exists as a pending create can be edited and deleted by pending_ id', async () => {
    const created = await call<{ pendingId: string }>('offline-queue:enqueue-create', { projectId: 7, fields: { title: 'x' } })
    if (!created.success) throw new Error('create failed')
    await call('offline-queue:enqueue-update', created.data.pendingId, { title: 'edited' })
    expect(queue.getPending()).toHaveLength(1)
    const deleted = await call<{ folded: boolean }>('offline-queue:enqueue-delete', created.data.pendingId)
    expect(deleted).toMatchObject({ success: true, data: { folded: true } })
    expect(queue.counts().pending).toBe(0)
  })

  it('enqueue-add-label and enqueue-remove-label', async () => {
    await call('offline-queue:enqueue-add-label', 5, { title: 'Home' })
    await call('offline-queue:enqueue-remove-label', 5, 9)
    expect(queue.getPending().map((a) => a.type)).toEqual(['add-label', 'remove-label'])
  })

  it('snapshot lists pending and failed actions with summaries', async () => {
    const a = await queue.enqueueComplete(5, true, { title: 'Pay rent' })
    await queue.enqueueDelete(6, { title: 'Old task' })
    await queue.failAction(a.actionId, { error: 'validation failed', statusCode: 422, reason: 'rejected' })

    const snapshot = await call<{ pending: Array<{ summary: string }>; failed: Array<{ summary: string; error: string }> }>('offline-queue:snapshot')

    expect(snapshot.success).toBe(true)
    if (!snapshot.success) return
    expect(snapshot.data.pending.map((p) => p.summary)).toEqual(['Delete "Old task"'])
    expect(snapshot.data.failed).toMatchObject([{ summary: 'Complete "Pay rent"', error: 'validation failed' }])
  })

  it('retry-failed puts failed actions back and asks for a replay; discard-failed removes them', async () => {
    const a = await queue.enqueueUpdate(5, { title: 'x' })
    const b = await queue.enqueueUpdate(6, { title: 'y' })
    await queue.failAction(a.actionId, { error: 'e', statusCode: 400, reason: 'rejected' })
    await queue.failAction(b.actionId, { error: 'e', statusCode: 400, reason: 'rejected' })

    expect(await call('offline-queue:retry-failed', [a.actionId])).toEqual({ success: true, data: 1 })
    expect(hoisted.replay).toHaveBeenCalledTimes(1)
    expect(queue.counts()).toEqual({ pending: 1, failed: 1 })

    expect(await call('offline-queue:discard-failed')).toEqual({ success: true, data: 1 })
    expect(queue.counts()).toEqual({ pending: 1, failed: 0 })
  })

  it('discard-pending removes queued actions', async () => {
    const a = await queue.enqueueUpdate(5, { title: 'x' })
    expect(await call('offline-queue:discard-pending', [a.actionId])).toEqual({ success: true, data: 1 })
    expect(queue.counts().pending).toBe(0)
  })

  it('replay-now runs a replay and returns its result', async () => {
    const event = { applied: 2, failed: 0, stopped: null, idMap: {}, counts: { pending: 0, failed: 0 } }
    hoisted.replay = vi.fn(async () => event)
    expect(await call('offline-queue:replay-now')).toEqual({ success: true, data: event })
  })

  describe('refuses malformed calls instead of storing them', () => {
    it.each([
      ['offline-queue:enqueue-update', [{}, { title: 'x' }]],
      ['offline-queue:enqueue-update', [5, 'not an object']],
      ['offline-queue:enqueue-update', [5, [1, 2]]],
      ['offline-queue:enqueue-complete', [5, 'yes']],
      ['offline-queue:enqueue-delete', [null]],
      ['offline-queue:enqueue-create', ['nope']],
      ['offline-queue:enqueue-create', [{ projectId: 'seven', fields: { title: 'x' } }]],
      ['offline-queue:enqueue-create', [{ projectId: 7, fields: 'x' }]],
      ['offline-queue:enqueue-add-label', [5, {}]],
      ['offline-queue:enqueue-remove-label', [5, 'label']],
      ['offline-queue:cancel-change', [5, 'done']],
      ['offline-queue:retry-failed', ['q1']],
      ['offline-queue:discard-failed', [{ id: 'q1' }]],
    ])('%s %j', async (channel, args) => {
      const result = await call(channel, ...args)
      expect(result.success).toBe(false)
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('reports queue errors as { success: false, error } instead of throwing', async () => {
      expect(await call('offline-queue:enqueue-update', 'pending_missing', { title: 'x' })).toMatchObject({
        success: false,
        error: expect.stringMatching(/not waiting/),
      })
      expect(await call('offline-queue:enqueue-create', { projectId: 7, fields: { title: '  ' } })).toMatchObject({
        success: false,
        error: expect.stringMatching(/title/),
      })
    })
  })
})

describe('parseQueuedLabels / parseQueuedImages', () => {
  it('keeps well-formed labels and trims titles', () => {
    expect(parseQueuedLabels([{ id: 3, title: ' Home ' }, { title: 'Garden' }, { id: 4 }])).toEqual([
      { id: 3, title: 'Home' },
      { title: 'Garden' },
      { id: 4 },
    ])
  })

  it('drops junk and caps the list', () => {
    expect(parseQueuedLabels('x')).toEqual([])
    expect(parseQueuedLabels([null, 'a', 5, { id: 0 }, { id: -1 }, { id: 1.5 }, { title: '   ' }, {}])).toEqual([])
    expect(parseQueuedLabels(Array.from({ length: 80 }, (_, i) => ({ id: i + 1 })))).toHaveLength(50)
  })

  it('keeps images with bytes and fills in defaults', () => {
    const bytes = new Uint8Array([1])
    expect(parseQueuedImages([{ bytes }, { name: 'a.png', mime: 'image/png', bytes }])).toEqual([
      { name: 'image', mime: 'application/octet-stream', bytes },
      { name: 'a.png', mime: 'image/png', bytes },
    ])
  })

  it('drops entries without real bytes', () => {
    expect(parseQueuedImages('x')).toEqual([])
    expect(parseQueuedImages([null, { bytes: 'str' }, { bytes: new Uint8Array(0) }, { bytes: [1, 2] }])).toEqual([])
  })
})
