import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import { parseTaskWriteOptions, taskWrites, writeTask } from '../offline/task-writes'
import { planTaskUpdate } from '../offline/notes-save-step'
import { quickViewPatch } from '../offline/quick-actions'
import { cancelPatchKeys, mergeUpdate } from '../offline/queue-merge'
import type { UpdateAction } from '../offline/types'
import type { ApiResult } from '../api-result'

// Description format, "Notes changed in two places": a notes edit carries the description it started
// from (the base); the write gate and the replay read the task first and keep both versions when the
// server's notes changed since.

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<never> => ({ success: false, error, statusCode })
const OFFLINE = err('net::ERR_INTERNET_DISCONNECTED')

const BASE = '<p>Shopping</p>'
const MINE = '<p>Shopping: milk</p>'
const THEIRS = '<p>Shopping: bread</p>'
const MERGED = `${THEIRS}<hr>${MINE}`

const DUE = '2026-11-13T22:59:59Z'
const NEXT = '2026-11-14T22:59:59Z'
const task = (description: string, due = DUE) => ({ id: 5, title: 'Shop', description, due_date: due, repeat_after: 86400, repeat_mode: 0 })

/** A fake API for the replay: every method answers ok unless scripted; every call is logged. */
function fakeReplayApi(script: Partial<Record<keyof ReplayApi, (...args: any[]) => ApiResult<any> | Promise<ApiResult<any>>>> = {}) {
  const calls: Array<{ op: string; args: unknown[] }> = []
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'connectionState' && !script.connectionState) return undefined
      return async (...args: unknown[]) => {
        calls.push({ op: prop, args })
        const custom = (script as Record<string, (...a: unknown[]) => unknown>)[prop]
        if (custom) return await custom(...args)
        if (prop === 'fetchLabels' || prop === 'fetchTaskAttachments') return ok([])
        return ok({ id: args[0] })
      }
    },
  }
  return { api: new Proxy({}, handler) as ReplayApi, calls, ops: () => calls.map((c) => c.op) }
}

const gateApi = (read: () => ApiResult<unknown>) => {
  const log: string[] = []
  return {
    log,
    api: {
      async updateTask(id: number, patch: Record<string, unknown>) {
        log.push(`PATCH ${id} ${JSON.stringify(patch)}`)
        return ok({ id, ...patch })
      },
      async fetchTaskById(id: number) {
        log.push(`GET ${id}`)
        return read()
      },
    },
  }
}

describe('planTaskUpdate (the notes step)', () => {
  it('sends the edit as it is while the server still holds the base', async () => {
    const read = vi.fn(async () => ok(task(BASE)))
    expect(await planTaskUpdate({ description: MINE }, { baseDescription: BASE }, read)).toEqual({ kind: 'send', patch: { description: MINE } })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('sends the merged notes when both sides changed them', async () => {
    const plan = await planTaskUpdate({ description: MINE, title: 'Shop!' }, { baseDescription: BASE }, async () => ok(task(THEIRS)))
    expect(plan).toEqual({ kind: 'send', patch: { description: MERGED, title: 'Shop!' }, notesMerged: true })
  })

  it('leaves the description out when the server already holds it, and sends the rest', async () => {
    const plan = await planTaskUpdate({ description: MINE, title: 'Shop!' }, { baseDescription: BASE }, async () => ok(task(MINE)))
    expect(plan).toEqual({ kind: 'send', patch: { title: 'Shop!' } })
  })

  it('sends nothing when only the notes were left and the server holds them, answering with the task read', async () => {
    const plan = await planTaskUpdate({ description: MINE }, { baseDescription: BASE }, async () => ok(task(MINE)))
    expect(plan).toEqual({ kind: 'answer', task: task(MINE) })
  })

  it('waits when the read fails because the server cannot be reached', async () => {
    const plan = await planTaskUpdate({ description: MINE }, { baseDescription: BASE }, async () => OFFLINE)
    expect(plan).toEqual({ kind: 'failed', failure: OFFLINE })
  })

  it('sends the edit as it is when the read fails for another reason', async () => {
    expect(await planTaskUpdate({ description: MINE }, { baseDescription: BASE }, async () => err('Internal', 500))).toEqual({
      kind: 'send',
      patch: { description: MINE },
    })
    expect(await planTaskUpdate({ description: MINE }, { baseDescription: BASE }, async () => err('Forbidden', 403))).toEqual({
      kind: 'send',
      patch: { description: MINE },
    })
  })

  it('makes no read without a base, or when the patch does not hold the notes', async () => {
    const read = vi.fn(async () => ok(task(THEIRS)))
    expect(await planTaskUpdate({ description: MINE }, {}, read)).toEqual({ kind: 'send', patch: { description: MINE } })
    expect(await planTaskUpdate({ title: 'x' }, { baseDescription: BASE }, read)).toEqual({ kind: 'send', patch: { title: 'x' } })
    expect(read).not.toHaveBeenCalled()
  })

  it('reads once when a patch needs both steps', async () => {
    const read = vi.fn(async () => ok(task(THEIRS, DUE)))
    const plan = await planTaskUpdate({ done: true, description: MINE }, { completedDue: DUE, baseDescription: BASE }, read)
    expect(plan).toEqual({ kind: 'send', patch: { done: true, description: MERGED }, notesMerged: true })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('answers as skipped when the completion is skipped and the server holds the notes already', async () => {
    const read = vi.fn(async () => ok(task(MINE, NEXT)))
    const plan = await planTaskUpdate({ done: true, description: MINE }, { completedDue: DUE, baseDescription: BASE }, read)
    expect(plan).toEqual({ kind: 'answer', task: task(MINE, NEXT), repeatSkipped: true })
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('offline: notes changed in two places', () => {
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-notes-'))
    idCounter = 0
    queue = fresh()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the queue keeps the base', () => {
    it('stores it with a notes edit, saves it and reads it back', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { title: 'Shop', baseDescription: BASE })
      expect(queue.getPending()[0]).toMatchObject({ type: 'update', patch: { description: MINE }, baseDescription: BASE })
      const saved = JSON.parse(readFileSync(join(dir, 'offline-queue.json'), 'utf8'))
      expect(saved.actions[0].baseDescription).toBe(BASE)
      expect(fresh().getPending()[0]).toMatchObject({ baseDescription: BASE })
    })

    it('reads an entry of an older version without the field', async () => {
      await queue.enqueueUpdate(5, { description: MINE })
      const path = join(dir, 'offline-queue.json')
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      expect(saved.actions[0]).not.toHaveProperty('baseDescription')
      saved.actions.push({ ...saved.actions[0], id: 'q9', taskId: 6, baseDescription: 7 })
      writeFileSync(path, JSON.stringify(saved))
      const reloaded = fresh().getPending()
      expect(reloaded).toHaveLength(2)
      expect(reloaded[0]).not.toHaveProperty('baseDescription')
      // A value of the wrong type is left out; the edit is sent as it is.
      expect(reloaded[1]).not.toHaveProperty('baseDescription')
    })

    it('keeps no base for a patch without the notes', async () => {
      await queue.enqueueUpdate(5, { title: 'x' }, { baseDescription: BASE })
      expect(queue.getPending()[0]).not.toHaveProperty('baseDescription')
    })

    it('keeps the base of the first edit when edits fold', () => {
      const action = { id: 'a', createdAt: '', attempts: 0, type: 'update' as const, taskId: 5 }
      const first: UpdateAction = { ...action, patch: { description: MINE }, baseDescription: BASE }
      const folded = mergeUpdate([first], { ...action, id: 'b', patch: { description: `${MINE}<p>eggs</p>` }, baseDescription: MINE }, null)
      expect(folded.actions[0]).toMatchObject({ patch: { description: `${MINE}<p>eggs</p>` }, baseDescription: BASE })

      // A first edit of the title only: the notes edit that joins it brings its own base.
      const titled = mergeUpdate([{ ...action, patch: { title: 'x' } }], { ...action, id: 'c', patch: { description: MINE }, baseDescription: BASE }, null)
      expect(titled.actions[0]).toMatchObject({ patch: { title: 'x', description: MINE }, baseDescription: BASE })

      // A first notes edit without a base keeps none.
      const unknown = mergeUpdate([{ ...action, patch: { description: MINE } }], { ...action, id: 'd', patch: { description: THEIRS }, baseDescription: MINE }, null)
      expect(unknown.actions[0]).not.toHaveProperty('baseDescription')
    })

    it('drops the base when the notes edit is taken back', () => {
      const action: UpdateAction = { id: 'a', createdAt: '', attempts: 0, type: 'update', taskId: 5, patch: { description: MINE, title: 'x' }, baseDescription: BASE }
      expect(cancelPatchKeys([action], 5, ['description'], null).actions[0]).not.toHaveProperty('baseDescription')
      expect(cancelPatchKeys([action], 5, ['title'], null).actions[0]).toMatchObject({ baseDescription: BASE })
    })

    it('a notes edit of a task still waiting to be created folds into the create without a base', async () => {
      const created = await queue.enqueueCreate({ projectId: 1, fields: { title: 'New', description: BASE } })
      await queue.enqueueUpdate(created.tempId, { description: MINE }, { baseDescription: BASE })
      expect(queue.getPending()).toHaveLength(1)
      expect(queue.getPending()[0]).toMatchObject({ type: 'create', fields: { description: MINE } })
    })
  })

  describe('the replay', () => {
    it('sends the edit when the server still holds the base', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { baseDescription: BASE })
      const { api, calls, ops } = fakeReplayApi({ fetchTaskById: () => ok(task(BASE)) })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById', 'updateTask'])
      expect(calls[1].args).toEqual([5, { description: MINE }])
      expect(event).toMatchObject({ applied: 1, stopped: null })
      expect(event).not.toHaveProperty('notesMerged')
    })

    it('sends both versions and reports the task when the notes changed on another device', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { baseDescription: BASE })
      const { api, calls } = fakeReplayApi({ fetchTaskById: () => ok(task(THEIRS)) })

      const event = await replayQueue(queue, api)

      expect(calls[1].args).toEqual([5, { description: MERGED }])
      expect(event).toMatchObject({ applied: 1, notesMerged: [5], counts: { pending: 0, failed: 0 } })
    })

    it('sends nothing when the server already holds the notes', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { baseDescription: BASE })
      const { api, ops } = fakeReplayApi({ fetchTaskById: () => ok(task(MINE)) })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById'])
      expect(event).toMatchObject({ applied: 1, counts: { pending: 0, failed: 0 } })
    })

    it('waits when the task cannot be read on the network', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { baseDescription: BASE })
      const { api, ops } = fakeReplayApi({ fetchTaskById: () => OFFLINE })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById'])
      expect(event).toMatchObject({ applied: 0, stopped: 'network', counts: { pending: 1, failed: 0 } })
    })

    it('sends the edit as it is when the read fails otherwise', async () => {
      await queue.enqueueUpdate(5, { description: MINE }, { baseDescription: BASE })
      const { api, calls } = fakeReplayApi({ fetchTaskById: () => err('Internal', 500) })

      await replayQueue(queue, api)

      expect(calls.map((c) => c.op)).toEqual(['fetchTaskById', 'updateTask'])
      expect(calls[1].args).toEqual([5, { description: MINE }])
    })

    it('sends an entry without a base as it is, with no read', async () => {
      await queue.enqueueUpdate(5, { description: MINE })
      const { api, ops } = fakeReplayApi()

      await replayQueue(queue, api)

      expect(ops()).toEqual(['updateTask'])
    })
  })

  describe('the write gate (a direct save)', () => {
    it('sends the edit when the server still holds the base', async () => {
      const { api, log } = gateApi(() => ok(task(BASE)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(outcome).toEqual({ kind: 'sent', result: { success: true, data: { id: 5, description: MINE } } })
      expect(log).toEqual(['GET 5', `PATCH 5 ${JSON.stringify({ description: MINE })}`])
    })

    it('sends both versions and marks the answer when the notes changed on another device', async () => {
      const { api, log } = gateApi(() => ok(task(THEIRS)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(outcome).toEqual({ kind: 'sent', result: { success: true, data: { id: 5, description: MERGED }, notesMerged: true } })
      expect(log).toEqual(['GET 5', `PATCH 5 ${JSON.stringify({ description: MERGED })}`])
    })

    it('sends nothing and answers with the task read when the server holds the notes already', async () => {
      const { api, log } = gateApi(() => ok(task(MINE)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(outcome).toEqual({ kind: 'sent', result: { success: true, data: task(MINE) } })
      expect(log).toEqual(['GET 5'])
    })

    it('queues the edit with its base when the read fails on the network', async () => {
      const { api, log } = gateApi(() => OFFLINE)
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(outcome).toEqual({ kind: 'queued', reason: 'unreachable' })
      expect(log).toEqual(['GET 5'])
      expect(queue.getPending()[0]).toMatchObject({ patch: { description: MINE }, baseDescription: BASE })
    })

    it('sends the edit as it is when the read fails otherwise', async () => {
      const { api, log } = gateApi(() => err('Internal', 500))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(outcome.kind).toBe('sent')
      expect(log).toEqual(['GET 5', `PATCH 5 ${JSON.stringify({ description: MINE })}`])
    })

    it('makes no read for a task that is not on the server yet', async () => {
      const { api, log } = gateApi(() => ok(task(THEIRS)))
      await writeTask({ queue }, taskWrites.update(queue, api, -3, { description: MINE }, 'Shop', { baseDescription: BASE }), { queue: true })
      expect(log).toEqual([`PATCH -3 ${JSON.stringify({ description: MINE })}`])
    })

    it('reads baseDescription from the IPC options', () => {
      expect(parseTaskWriteOptions({ queue: true, baseDescription: BASE })).toEqual({ queue: true, baseDescription: BASE })
      expect(parseTaskWriteOptions({ baseDescription: '' })).toEqual({ baseDescription: '' })
      expect(parseTaskWriteOptions({ baseDescription: null })).toEqual({})
    })

    it('Quick View passes the base of a notes edit', async () => {
      const { api, log } = gateApi(() => ok(task(THEIRS)))
      const deps = { queue, api: { ...api, createTask: async () => ok({ id: 1 }) }, notifyMainWindow: () => {} }
      const result = await quickViewPatch(deps, 5, { description: MINE }, undefined, { baseDescription: BASE })
      expect(result).toMatchObject({ success: true, notesMerged: true, data: { description: MERGED } })
      expect(log).toEqual(['GET 5', `PATCH 5 ${JSON.stringify({ description: MERGED })}`])
    })
  })
})
