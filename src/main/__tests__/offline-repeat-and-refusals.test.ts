import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import { classifyReplayFailure, refusedWhileSignedIn } from '../offline/classify'
import { parseTaskWriteOptions, taskWrites, writeTask } from '../offline/task-writes'
import { planRepeatCompletion } from '../offline/repeat-completion-step'
import { quickViewComplete } from '../offline/quick-actions'
import { cancelPatchKeys, mergeUpdate } from '../offline/queue-merge'
import type { UpdateAction } from '../offline/types'
import type { ApiResult } from '../api-result'
import { NOT_API_RESPONSE_MESSAGE } from '../../shared/error-classify'

// Cross-app semantics 7.5 (a repeating task completed on two devices), C-1 (a web page answered
// with 200) and C-2 (a 403 while the session still works) in the queue, the replay and the gate.

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<never> => ({ success: false, error, statusCode })
const NOT_API: ApiResult<never> = { success: false, error: NOT_API_RESPONSE_MESSAGE, notApiResponse: true }

const DUE = '2026-11-13T22:59:59Z'
const NEXT = '2026-11-14T22:59:59Z'
const daily = (due: string, done = false) => ({ id: 5, title: 'Take pills', done, due_date: due, repeat_after: 86400, repeat_mode: 0 })

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
        if (prop === 'findRecentCreate' || prop === 'findRecentComment') return ok(null)
        return ok({ id: args[0] })
      }
    },
  }
  return { api: new Proxy({}, handler) as ReplayApi, calls, ops: () => calls.map((c) => c.op) }
}

describe('offline: repeating completions, web pages and refusals', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-repeat-'))
    idCounter = 0
    queue = fresh()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the queue keeps the completed due', () => {
    it('stores it with a completion, saves it and reads it back', async () => {
      await queue.enqueueComplete(5, true, { title: 'Take pills', completedDue: DUE })
      expect(queue.getPending()[0]).toMatchObject({ type: 'update', patch: { done: true }, completedDue: DUE })
      const saved = JSON.parse(readFileSync(join(dir, 'offline-queue.json'), 'utf8'))
      expect(saved.actions[0].completedDue).toBe(DUE)
      expect(fresh().getPending()[0]).toMatchObject({ completedDue: DUE })
    })

    it('keeps null (no date) apart from no check', async () => {
      await queue.enqueueComplete(5, true, { completedDue: null })
      await queue.enqueueComplete(6, true)
      expect(queue.getPending()[0]).toHaveProperty('completedDue', null)
      expect(queue.getPending()[1]).not.toHaveProperty('completedDue')
    })

    it('is dropped with a reopen and when the completion is taken back', async () => {
      await queue.enqueueUpdate(5, { title: 'Renamed' })
      await queue.enqueueComplete(5, true, { completedDue: DUE })
      expect(queue.getPending()[0]).toMatchObject({ patch: { title: 'Renamed', done: true }, completedDue: DUE })

      await queue.cancelChange(5, ['done'])
      expect(queue.getPending()[0]).toMatchObject({ patch: { title: 'Renamed' } })
      expect(queue.getPending()[0]).not.toHaveProperty('completedDue')
    })

    it('follows the newest done when patches fold', () => {
      const base = { id: 'a', createdAt: '', attempts: 0, type: 'update' as const, taskId: 5 }
      const done: UpdateAction = { ...base, patch: { done: true }, completedDue: DUE }
      const reopened = mergeUpdate([done], { ...base, id: 'b', patch: { done: false } }, null)
      expect(reopened.actions[0]).not.toHaveProperty('completedDue')
      const edited = mergeUpdate([done], { ...base, id: 'c', patch: { title: 'x' } }, null)
      expect(edited.actions[0]).toMatchObject({ completedDue: DUE })
      const cancelled = cancelPatchKeys([{ ...done, patch: { done: true, title: 'x' } }], 5, ['title'], null)
      expect(cancelled.actions[0]).toMatchObject({ completedDue: DUE })
    })
  })

  describe('planRepeatCompletion', () => {
    it('makes no read for a task that does not repeat, or a patch that is not a completion', async () => {
      const read = vi.fn(async () => ok(daily(DUE)))
      expect(await planRepeatCompletion({ done: true }, undefined, read)).toEqual({ kind: 'send', patch: { done: true } })
      expect(await planRepeatCompletion({ done: false }, DUE, read)).toEqual({ kind: 'send', patch: { done: false } })
      expect(await planRepeatCompletion({ done: true, due_date: NEXT }, DUE, read)).toEqual({ kind: 'send', patch: { done: true, due_date: NEXT } })
      expect(read).not.toHaveBeenCalled()
    })

    it('sends what else the patch holds when only the completion is skipped', async () => {
      const plan = await planRepeatCompletion({ done: true, title: 'x' }, DUE, async () => ok(daily(NEXT)))
      expect(plan).toEqual({ kind: 'send', patch: { title: 'x' } })
    })
  })

  describe('the replay (a queued completion)', () => {
    it('sends it when the server still holds the occurrence', async () => {
      await queue.enqueueComplete(5, true, { completedDue: DUE })
      const { api, calls, ops } = fakeReplayApi({ fetchTaskById: () => ok(daily(DUE)) })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById', 'updateTask'])
      expect(calls[1].args).toEqual([5, { done: true }])
      expect(event).toMatchObject({ applied: 1, stopped: null, counts: { pending: 0, failed: 0 } })
    })

    it('skips it when another device moved the task on, and counts it as done', async () => {
      await queue.enqueueComplete(5, true, { completedDue: DUE })
      const { api, ops } = fakeReplayApi({ fetchTaskById: () => ok(daily(NEXT)) })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById'])
      expect(event).toMatchObject({ applied: 1, failed: 0, stopped: null, counts: { pending: 0, failed: 0 } })
    })

    it('waits when the task cannot be read', async () => {
      await queue.enqueueComplete(5, true, { completedDue: DUE })
      const { api, ops } = fakeReplayApi({ fetchTaskById: () => err('net::ERR_INTERNET_DISCONNECTED') })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['fetchTaskById'])
      expect(event).toMatchObject({ applied: 0, stopped: 'network', counts: { pending: 1, failed: 0 } })
    })

    it('moves it to the failed log when the task is gone (404, as for any change)', async () => {
      await queue.enqueueComplete(5, true, { completedDue: DUE })
      const { api } = fakeReplayApi({ fetchTaskById: () => err('Not found', 404) })

      const event = await replayQueue(queue, api)

      expect(event).toMatchObject({ stopped: null, counts: { pending: 0, failed: 1 } })
      expect(queue.getFailed()[0].reason).toBe('task-gone')
    })

    it('sends a completion without a completed due (an older version) as before, with no read', async () => {
      await queue.enqueueComplete(5, true)
      const { api, ops } = fakeReplayApi()

      await replayQueue(queue, api)

      expect(ops()).toEqual(['updateTask'])
    })
  })

  describe('the write gate (a direct completion)', () => {
    const gateApi = (task: () => ApiResult<unknown>) => {
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
            return task()
          },
        },
      }
    }

    it('sends the completion when the server holds the occurrence', async () => {
      const { api, log } = gateApi(() => ok(daily(DUE)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Take pills', { completedDue: DUE }), { queue: true })
      expect(outcome.kind).toBe('sent')
      expect(log).toEqual(['GET 5', 'PATCH 5 {"done":true}'])
    })

    it('skips it and answers with the server task, marked repeatSkipped', async () => {
      const { api, log } = gateApi(() => ok(daily(NEXT)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Take pills', { completedDue: DUE }), { queue: true })
      expect(outcome).toEqual({ kind: 'sent', result: { success: true, data: daily(NEXT), repeatSkipped: true } })
      expect(log).toEqual(['GET 5'])
      expect(queue.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('queues the completion with its completed due when the read fails on the network', async () => {
      const { api, log } = gateApi(() => err('net::ERR_INTERNET_DISCONNECTED'))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Take pills', { completedDue: DUE }), { queue: true })
      expect(outcome).toEqual({ kind: 'queued', reason: 'unreachable' })
      expect(log).toEqual(['GET 5'])
      expect(queue.getPending()[0]).toMatchObject({ patch: { done: true }, completedDue: DUE })
    })

    it('refuses a caller that cannot queue when the read fails', async () => {
      const { api } = gateApi(() => err('net::ERR_INTERNET_DISCONNECTED'))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Take pills', { completedDue: DUE }))
      expect(outcome.kind).toBe('refused')
      expect(queue.counts().pending).toBe(0)
    })

    it('makes no extra request for a task that does not repeat', async () => {
      const { api, log } = gateApi(() => ok(daily(DUE)))
      await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Plain'), { queue: true })
      expect(log).toEqual(['PATCH 5 {"done":true}'])
    })

    it('queues behind waiting changes with the completed due, without reading', async () => {
      await queue.enqueueUpdate(5, { title: 'Earlier' })
      const { api, log } = gateApi(() => ok(daily(DUE)))
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { done: true }, 'Take pills', { completedDue: DUE }), { queue: true })
      expect(outcome).toEqual({ kind: 'queued', reason: 'behind-queue' })
      expect(log).toEqual([])
      expect(queue.getPending()[0]).toMatchObject({ patch: { title: 'Earlier', done: true }, completedDue: DUE })
    })

    it('reads completedDue from the IPC options, null included', () => {
      expect(parseTaskWriteOptions({ queue: true, completedDue: DUE })).toEqual({ queue: true, completedDue: DUE })
      expect(parseTaskWriteOptions({ completedDue: null })).toEqual({ completedDue: null })
      expect(parseTaskWriteOptions({ completedDue: 5 })).toEqual({})
    })

    it('Quick View sends the completed due of a repeating row, and nothing extra for a plain one', async () => {
      const { api, log } = gateApi(() => ok(daily(NEXT)))
      const deps = { queue, api: { ...api, createTask: async () => ok({ id: 1 }) }, notifyMainWindow: () => {} }

      const skipped = await quickViewComplete(deps, 5, daily(DUE))
      expect(skipped).toMatchObject({ success: true, repeatSkipped: true })
      expect(log).toEqual(['GET 5'])

      log.length = 0
      await quickViewComplete(deps, 6, { id: 6, title: 'Plain', due_date: DUE, repeat_after: 0, repeat_mode: 0 })
      expect(log).toEqual(['PATCH 6 {"done":true}'])
    })
  })

  describe('a web page instead of the API (C-1)', () => {
    it('stops the replay like a network problem and keeps the change', async () => {
      await queue.enqueueUpdate(5, { title: 'x' })
      const { api } = fakeReplayApi({ updateTask: () => NOT_API })

      const event = await replayQueue(queue, api)

      expect(event).toMatchObject({ stopped: 'network', counts: { pending: 1, failed: 0 } })
      expect(classifyReplayFailure(NOT_API as { error: string; notApiResponse: true }, 'create')).toEqual({ kind: 'stop', why: 'network' })
    })

    it('queues a direct change', async () => {
      const api = { updateTask: async () => NOT_API }
      const outcome = await writeTask({ queue }, taskWrites.update(queue, api, 5, { title: 'x' }), { queue: true })
      expect(outcome).toEqual({ kind: 'queued', reason: 'unreachable' })
    })
  })

  describe('a 403 on a queued task change (C-2)', () => {
    it('goes to the failed log as no write access when the session works, and the replay carries on', async () => {
      await queue.enqueueUpdate(5, { title: 'x' })
      await queue.enqueueUpdate(6, { title: 'y' })
      const { api, ops } = fakeReplayApi({
        updateTask: (id: number) => (id === 5 ? err('Forbidden', 403) : ok({ id })),
        connectionState: () => 'works' as never,
      })

      const event = await replayQueue(queue, api)

      expect(ops()).toEqual(['updateTask', 'connectionState', 'updateTask'])
      expect(event).toMatchObject({ applied: 1, failed: 1, stopped: null, counts: { pending: 0, failed: 1 } })
      expect(queue.getFailed()[0]).toMatchObject({ reason: 'no-write-access', statusCode: 403 })
      expect(queue.getAuthProblem()).toBeNull()
    })

    it('still stops as an auth problem when the session is gone', async () => {
      await queue.enqueueUpdate(5, { title: 'x' })
      const { api } = fakeReplayApi({ updateTask: () => err('Forbidden', 403), connectionState: () => 'refused' as never })

      const event = await replayQueue(queue, api)

      expect(event).toMatchObject({ stopped: 'auth', counts: { pending: 1, failed: 0 } })
    })

    it('waits as a network problem when the check gets no answer', async () => {
      await queue.enqueueUpdate(5, { title: 'x' })
      const { api } = fakeReplayApi({ updateTask: () => err('Forbidden', 403), connectionState: () => 'unknown' as never })

      expect(await replayQueue(queue, api)).toMatchObject({ stopped: 'network', counts: { pending: 1 } })
    })

    it('never checks a 401', () => {
      expect(refusedWhileSignedIn({ error: 'x', statusCode: 401 }, 'works')).toBeNull()
      expect(refusedWhileSignedIn({ error: 'x', statusCode: 403 }, 'works')).toEqual({ kind: 'drop', reason: 'no-write-access' })
    })
  })

  describe('discarding waiting changes (E-1)', () => {
    it('drops a create with the changes made to its task, relations to it included', async () => {
      const a = await queue.enqueueCreate({ projectId: 1, fields: { title: 'New' } })
      await queue.enqueueAddLabel(a.tempId, { id: 3 })
      await queue.enqueueUpdate(9, { title: 'other' })
      await queue.enqueueAddRelation(9, a.tempId, 'related')

      const removed = await queue.discardPending([a.actionId])

      expect(removed).toBe(3)
      expect(queue.getPending().map((p) => p.type)).toEqual(['update'])
    })

    it('leaves the change that is being sent', async () => {
      await queue.enqueueUpdate(5, { title: 'x' })
      const id = queue.getPending()[0].id
      expect(queue.beginSend(id)).toBe(true)
      expect(await queue.discardPending([id])).toBe(0)
      queue.endSend()
      expect(await queue.discardPending([id])).toBe(1)
    })
  })
})
