import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import {
  WAITING_TO_SYNC_ERROR,
  parseTaskWriteOptions,
  NOT_SENT_AFTER_NETWORK_FAILURE,
  sendSerially,
  taskWriteReply,
  taskWrites,
  writeTask,
} from '../offline/task-writes'
import type { ApiResult } from '../api-result'
import { isQueueableFailure } from '../../shared/error-classify'

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<never> => ({ success: false, error, statusCode })

/**
 * A tiny Vikunja: it keeps each task's title and labels and logs every request in the order it
 * arrived, which is what the lost-edit bug is about. `outage` makes every request fail like a
 * dropped connection.
 */
function fakeServer() {
  const titles = new Map<number, string>([[5, 'Original']])
  const labels = new Map<number, Set<number>>([[5, new Set()]])
  const log: string[] = []
  const state = { outage: false as boolean | string }
  const down = (): ApiResult<never> | null => (state.outage ? err(typeof state.outage === 'string' ? state.outage : 'net::ERR_INTERNET_DISCONNECTED') : null)

  const api = {
    async updateTask(id: number, patch: Record<string, unknown>): Promise<ApiResult<unknown>> {
      log.push(`PATCH ${id} ${JSON.stringify(patch)}`)
      const failure = down()
      if (failure) return failure
      if (typeof patch.title === 'string') titles.set(id, patch.title)
      return ok({ id })
    },
    async deleteTask(id: number): Promise<ApiResult<unknown>> {
      log.push(`DELETE ${id}`)
      const failure = down()
      if (failure) return failure
      titles.delete(id)
      return ok(undefined)
    },
    async addLabelToTask(id: number, labelId: number): Promise<ApiResult<unknown>> {
      log.push(`ADD-LABEL ${id} ${labelId}`)
      const failure = down()
      if (failure) return failure
      labels.get(id)?.add(labelId)
      return ok(undefined)
    },
    async removeLabelFromTask(id: number, labelId: number): Promise<ApiResult<unknown>> {
      log.push(`REMOVE-LABEL ${id} ${labelId}`)
      const failure = down()
      if (failure) return failure
      labels.get(id)?.delete(labelId)
      return ok(undefined)
    },
  }
  return { api, titles, labels, log, state }
}

describe('writeTask: a change never goes around the queue (F1)', () => {
  let dir: string
  let queue: OfflineQueue
  let server: ReturnType<typeof fakeServer>
  let idCounter: number
  let replays: number
  let warn: ReturnType<typeof vi.spyOn>

  const deps = () => ({ queue, requestReplay: () => void replays++ })
  const edit = (title: string, options: { queue?: boolean } = { queue: true }) =>
    writeTask(deps(), taskWrites.update(queue, server.api, 5, { title }, 'Task'), options)

  /** The replay talks to the same fake server, as the real one talks to Vikunja. */
  const replay = () => replayQueue(queue, server.api as unknown as ReplayApi)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-task-writes-'))
    idCounter = 0
    replays = 0
    server = fakeServer()
    queue = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++idCounter}`,
    })
    queue.load()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the reproduced EDIT1 / EDIT2 sequence', () => {
    it('sends the first edit, queues it when the server is down, and keeps the second edit behind it so EDIT2 wins', async () => {
      server.state.outage = true
      expect(await edit('EDIT1')).toEqual({ kind: 'queued', reason: 'unreachable' })
      expect(queue.getPending()).toHaveLength(1)

      // The server is back, but EDIT1 has not been replayed yet. Sending EDIT2 straight away is what
      // used to lose it: the replay then sent EDIT1 on top.
      server.state.outage = false
      server.log.length = 0
      expect(await edit('EDIT2')).toEqual({ kind: 'queued', reason: 'behind-queue' })
      expect(server.log).toEqual([])
      expect(queue.getPending()).toHaveLength(1)
      expect(queue.getPending()[0]).toMatchObject({ type: 'update', taskId: 5, patch: { title: 'EDIT2' } })

      const event = await replay()

      expect(event).toMatchObject({ applied: 1, failed: 0, stopped: null })
      expect(server.log).toEqual(['PATCH 5 {"title":"EDIT2"}'])
      expect(server.titles.get(5)).toBe('EDIT2')
      expect(queue.counts().pending).toBe(0)
    })

    it('asks for a replay when a change joins a waiting queue', async () => {
      server.state.outage = true
      await edit('EDIT1')
      server.state.outage = false
      replays = 0

      await edit('EDIT2')

      expect(replays).toBe(1)
    })

    it('goes straight to the server when nothing is waiting for the task', async () => {
      const outcome = await edit('EDIT1')
      expect(outcome).toMatchObject({ kind: 'sent' })
      expect(server.log).toEqual(['PATCH 5 {"title":"EDIT1"}'])
      expect(queue.getPending()).toHaveLength(0)
      expect(replays).toBe(0)
    })

    it('does not hold back a change to another task', async () => {
      server.state.outage = true
      await edit('EDIT1')
      server.state.outage = false
      server.titles.set(6, 'Other')
      server.log.length = 0

      const outcome = await writeTask(deps(), taskWrites.update(queue, server.api, 6, { title: 'Other edited' }, 'Other'), { queue: true })

      expect(outcome).toMatchObject({ kind: 'sent' })
      expect(server.log).toEqual(['PATCH 6 {"title":"Other edited"}'])
      // A request got through: waiting changes for the other tasks are worth sending now.
      expect(replays).toBe(1)
    })

    it('queues a change behind the action that is being sent right now, in order', async () => {
      server.state.outage = true
      await edit('EDIT1')
      server.state.outage = false

      // The replay is sending EDIT1 (its request is on the wire) while the user types EDIT2.
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      const sent: string[] = []
      const slowApi = {
        ...server.api,
        updateTask: async (id: number, patch: Record<string, unknown>) => {
          sent.push(String(patch.title))
          if (patch.title === 'EDIT1') await gate
          return server.api.updateTask(id, patch)
        },
      } as unknown as ReplayApi
      const replaying = replayQueue(queue, slowApi)
      await vi.waitFor(() => expect(sent).toEqual(['EDIT1']))

      expect(await edit('EDIT2')).toEqual({ kind: 'queued', reason: 'behind-queue' })
      release()
      await replaying

      expect(sent).toEqual(['EDIT1', 'EDIT2'])
      expect(server.titles.get(5)).toBe('EDIT2')
    })
  })

  describe('a request that is still in flight', () => {
    it('is not overtaken by the next change: when it fails, the next change queues behind it', async () => {
      let fail: (value: ApiResult<never>) => void = () => undefined
      const hung = new Promise<ApiResult<never>>((resolve) => { fail = resolve })
      const api = {
        updateTask: vi.fn(async (_id: number, patch: Record<string, unknown>) => (patch.title === 'EDIT1' ? hung : ok({ id: 5 }))),
      }

      const first = writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'EDIT1' }), { queue: true })
      const second = writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'EDIT2' }), { queue: true })
      await Promise.resolve()
      expect(api.updateTask).toHaveBeenCalledTimes(1)

      fail(err('Request timed out'))
      expect(await first).toEqual({ kind: 'queued', reason: 'unreachable' })
      expect(await second).toEqual({ kind: 'queued', reason: 'behind-queue' })

      expect(api.updateTask).toHaveBeenCalledTimes(1)
      expect(queue.getPending()).toHaveLength(1)
      expect(queue.getPending()[0]).toMatchObject({ patch: { title: 'EDIT2' } })
    })

    it('lets the next change through, in order, when it succeeds', async () => {
      const order: string[] = []
      let finish: () => void = () => undefined
      const hung = new Promise<void>((resolve) => { finish = resolve })
      const api = {
        updateTask: async (_id: number, patch: Record<string, unknown>) => {
          order.push(`start ${patch.title}`)
          if (patch.title === 'EDIT1') await hung
          order.push(`end ${patch.title}`)
          return ok({ id: 5 })
        },
      }

      const first = writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'EDIT1' }), { queue: true })
      const second = writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'EDIT2' }), { queue: true })
      await Promise.resolve()
      finish()
      await Promise.all([first, second])

      expect(order).toEqual(['start EDIT1', 'end EDIT1', 'start EDIT2', 'end EDIT2'])
    })

    it('sends a change to another task after the one in flight (one request at a time), without queueing it', async () => {
      const order: string[] = []
      let finish: () => void = () => undefined
      const hung = new Promise<void>((resolve) => { finish = resolve })
      const api = {
        updateTask: async (id: number) => {
          order.push(`start ${id}`)
          if (id === 5) await hung
          order.push(`end ${id}`)
          return ok({ id })
        },
      }
      const slow = writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'a' }), { queue: true })
      const other = writeTask(deps(), taskWrites.update(queue, api, 6, { title: 'b' }), { queue: true })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(order).toEqual(['start 5'])
      finish()
      expect(await slow).toMatchObject({ kind: 'sent' })
      expect(await other).toMatchObject({ kind: 'sent' })
      expect(order).toEqual(['start 5', 'end 5', 'start 6', 'end 6'])
      expect(queue.getPending()).toHaveLength(0)
    })

    it('keeps working after a write threw', async () => {
      const api = {
        updateTask: vi.fn().mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValue(ok({ id: 5 })),
      }
      const first = await writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'a' }), { queue: true })
      // A thrown "socket hang up" counts as a connection failure: queued.
      expect(first).toEqual({ kind: 'queued', reason: 'unreachable' })
      await queue.discardPending(queue.getPending().map((a) => a.id))
      const second = await writeTask(deps(), taskWrites.update(queue, api, 5, { title: 'b' }), { queue: true })
      expect(second).toMatchObject({ kind: 'sent' })
    })
  })

  describe('failures that are not about the connection', () => {
    it.each([
      ['a validation error', err('Invalid due date', 422), 422],
      ['a missing task', err('Not found', 404), 404],
      ['an expired session', err('Session expired. Please sign in again.'), undefined],
      ['a permission error', err('Forbidden', 403), 403],
    ])('does not queue %s', async (_name, failure, status) => {
      const api = { updateTask: async () => failure }
      const outcome = await writeTask(deps(), taskWrites.update(queue, api, 5, { priority: 2 }), { queue: true })
      expect(outcome).toMatchObject({ kind: 'refused', result: { success: false, statusCode: status } })
      expect(queue.getPending()).toHaveLength(0)
    })

    it.each([
      ['a network error', err('net::ERR_INTERNET_DISCONNECTED')],
      ['a timeout', err('Request timed out')],
      ['a server error', err('Internal Server Error', 500)],
      ['rate limiting', err('Too Many Requests', 429)],
    ])('queues %s', async (_name, failure) => {
      const api = { updateTask: async () => failure }
      const outcome = await writeTask(deps(), taskWrites.update(queue, api, 5, { priority: 2 }, 'Pay rent'), { queue: true })
      expect(outcome).toEqual({ kind: 'queued', reason: 'unreachable' })
      expect(queue.getPending()[0]).toMatchObject({ type: 'update', taskId: 5, patch: { priority: 2 }, title: 'Pay rent' })
    })

    it('reports the original status when the queue itself cannot take the change', async () => {
      const api = { updateTask: async () => err('Bad Gateway', 502) }
      const broken = { ...queue, hasPendingFor: () => false, counts: () => ({ pending: 0, failed: 0 }), enqueueUpdate: async () => { throw new Error('disk full') } } as unknown as OfflineQueue
      const outcome = await writeTask({ queue: broken }, taskWrites.update(broken, api, 5, { priority: 2 }), { queue: true })
      expect(outcome).toMatchObject({ kind: 'refused', result: { success: false, error: 'Could not save offline: disk full', statusCode: 502 } })
    })
  })

  describe('a caller that cannot queue', () => {
    it('gets the server failure as it is (nothing is queued for it)', async () => {
      server.state.outage = true
      const outcome = await edit('EDIT1', {})
      expect(outcome).toMatchObject({ kind: 'refused', result: { success: false, error: 'net::ERR_INTERNET_DISCONNECTED' } })
      expect(queue.getPending()).toHaveLength(0)
    })

    it('is refused, and nothing is sent, while changes for the task are waiting', async () => {
      server.state.outage = true
      await edit('EDIT1')
      server.state.outage = false
      server.log.length = 0

      const outcome = await edit('EDIT2', {})

      expect(outcome).toEqual({ kind: 'refused', result: { success: false, error: WAITING_TO_SYNC_ERROR } })
      expect(server.log).toEqual([])
      expect(queue.getPending()[0]).toMatchObject({ patch: { title: 'EDIT1' } })
    })
  })

  describe('the other task writes', () => {
    it('a delete folds the waiting changes away and replaces them with one delete', async () => {
      server.state.outage = true
      await edit('EDIT1')
      server.state.outage = false
      server.log.length = 0

      const outcome = await writeTask(deps(), taskWrites.delete(queue, server.api, 5, 'Task'), { queue: true })

      expect(outcome).toEqual({ kind: 'queued', reason: 'behind-queue' })
      expect(server.log).toEqual([])
      expect(queue.getPending().map((a) => a.type)).toEqual(['delete'])
      await replay()
      expect(server.log).toEqual(['DELETE 5'])
    })

    it('removing a label that was queued for adding cancels both, so the label is never added', async () => {
      server.state.outage = true
      expect(await writeTask(deps(), taskWrites.addLabel(queue, server.api, 5, { id: 3, title: 'home' }, 'Task'), { queue: true })).toEqual({ kind: 'queued', reason: 'unreachable' })
      server.state.outage = false
      server.log.length = 0

      const outcome = await writeTask(deps(), taskWrites.removeLabel(queue, server.api, 5, 3, 'Task'), { queue: true })

      expect(outcome).toEqual({ kind: 'queued', reason: 'behind-queue' })
      expect(server.log).toEqual([])
      expect(queue.getPending()).toHaveLength(0)
      expect(server.labels.get(5)?.has(3)).toBe(false)
    })

    it('adding a label after a queued removal of another label is sent in order', async () => {
      server.state.outage = true
      await writeTask(deps(), taskWrites.removeLabel(queue, server.api, 5, 4, 'Task'), { queue: true })
      server.state.outage = false
      server.log.length = 0

      await writeTask(deps(), taskWrites.addLabel(queue, server.api, 5, { id: 3 }), { queue: true })
      expect(server.log).toEqual([])
      await replay()
      expect(server.log).toEqual(['REMOVE-LABEL 5 4', 'ADD-LABEL 5 3'])
    })
  })

  describe('a task that only exists as a pending create', () => {
    it('counts as having pending work, so its edits fold into the create', async () => {
      const created = await queue.enqueueCreate({ projectId: 1, fields: { title: 'Draft' } })
      expect(queue.hasPendingFor(created.tempId)).toBe(true)

      const api = { updateTask: vi.fn(async () => ok({})) }
      const outcome = await writeTask(deps(), taskWrites.update(queue, api, created.tempId, { title: 'Final' }), { queue: true })

      expect(outcome).toEqual({ kind: 'queued', reason: 'behind-queue' })
      expect(api.updateTask).not.toHaveBeenCalled()
      expect(queue.getPending()[0]).toMatchObject({ type: 'create', fields: { title: 'Final' } })
    })
  })
})

describe('hasPendingFor', () => {
  let dir: string
  let queue: OfflineQueue

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-has-pending-'))
    queue = new OfflineQueue({ queuePath: join(dir, 'q.json'), attachmentsDir: join(dir, 'a') })
    queue.load()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is true for every kind of action that belongs to the task, and only for it', async () => {
    expect(queue.hasPendingFor(5)).toBe(false)
    await queue.enqueueAddLabel(5, { id: 1 })
    expect(queue.hasPendingFor(5)).toBe(true)
    expect(queue.hasPendingFor(6)).toBe(false)
    await queue.enqueueDelete(7)
    expect(queue.hasPendingFor(7)).toBe(true)
  })

  it('is false again once the actions are gone', async () => {
    await queue.enqueueUpdate(5, { title: 'x' })
    await queue.discardPending(queue.getPending().map((a) => a.id))
    expect(queue.hasPendingFor(5)).toBe(false)
  })
})

describe('taskWriteReply and parseTaskWriteOptions', () => {
  it('answers a queued change with the marker, a sent one with the server result', () => {
    expect(taskWriteReply({ kind: 'queued', reason: 'unreachable' })).toEqual({ success: true, queued: true, data: null })
    expect(taskWriteReply({ kind: 'sent', result: { success: true, data: { id: 5 } } })).toEqual({ success: true, data: { id: 5 } })
    expect(taskWriteReply({ kind: 'refused', result: { success: false, error: 'no' } })).toEqual({ success: false, error: 'no' })
  })

  it('reads only well-formed options; anything else means the caller cannot queue', () => {
    expect(parseTaskWriteOptions(undefined)).toEqual({})
    expect(parseTaskWriteOptions('queue')).toEqual({})
    expect(parseTaskWriteOptions([true])).toEqual({})
    expect(parseTaskWriteOptions({ queue: 'yes' })).toEqual({})
    expect(parseTaskWriteOptions({ queue: true, title: 'Pay rent', labelTitle: 'home', extra: 1 })).toEqual({
      queue: true,
      title: 'Pay rent',
      labelTitle: 'home',
    })
  })
})

describe('sendSerially: changes to different tasks leave one at a time', () => {
  it('never has two requests in flight, and keeps the order they were asked in', async () => {
    let inFlight = 0
    let peak = 0
    const order: number[] = []
    const send = (id: number) => async (): Promise<ApiResult<unknown>> => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5 - (id % 3)))
      order.push(id)
      inFlight--
      return ok({ id })
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map((id) => sendSerially(send(id))))
    expect(peak).toBe(1)
    expect(order).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('goes on after a request that failed or threw', async () => {
    const results = await Promise.allSettled([
      sendSerially(async () => {
        throw new Error('boom')
      }),
      sendSerially(async () => 'second'),
    ])
    expect(results[0].status).toBe('rejected')
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'second' })
  })

  describe('when the server cannot be reached', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    const timeout = (ms: number, error: string, calls: number[], id: number) => async (): Promise<ApiResult<unknown>> => {
      calls.push(id)
      await new Promise((resolve) => setTimeout(resolve, ms))
      return err(error)
    }

    it('fails the waiting requests at once instead of letting each wait its own timeout', async () => {
      vi.useFakeTimers()
      const calls: number[] = []
      const results = [1, 2, 3, 4].map((id) => sendSerially(timeout(10_000, 'Request timed out', calls, id)))
      const settled = Promise.all(results)
      await vi.advanceTimersByTimeAsync(10_000)
      const all = await settled
      // Only the first went to the network; the others failed in the same instant, not 10 s apart.
      expect(calls).toEqual([1])
      expect(all[0]).toEqual(err('Request timed out'))
      for (const result of all.slice(1)) expect(result).toEqual(NOT_SENT_AFTER_NETWORK_FAILURE)
      // The skipped answer is a failure the gate queues (and a create may be queued too: nothing was sent).
      expect(isQueueableFailure(NOT_SENT_AFTER_NETWORK_FAILURE as { error: string }, 'change')).toBe(true)
      expect(isQueueableFailure(NOT_SENT_AFTER_NETWORK_FAILURE as { error: string }, 'create')).toBe(true)
    })

    it('tries the network again for a request that arrives after the failure', async () => {
      vi.useFakeTimers()
      const calls: number[] = []
      const first = sendSerially(timeout(10_000, 'net::ERR_INTERNET_DISCONNECTED', calls, 1))
      await vi.advanceTimersByTimeAsync(10_000)
      await first
      const later = await sendSerially(async () => {
        calls.push(2)
        return ok('back online')
      })
      expect(later).toEqual(ok('back online'))
      expect(calls).toEqual([1, 2])
    })

    it('keeps sending the waiting requests when the server answered with an error status', async () => {
      const calls: number[] = []
      const send = (id: number, result: ApiResult<unknown>) => async () => {
        calls.push(id)
        return result
      }
      const results = await Promise.all([
        sendSerially(send(1, err('Internal Server Error', 500))),
        sendSerially(send(2, err('Not found', 404))),
        sendSerially(send(3, ok('fine'))),
      ])
      expect(calls).toEqual([1, 2, 3])
      expect(results[2]).toEqual(ok('fine'))
    })

    it('moves every change of a bulk edit to the offline queue after one timeout', async () => {
      vi.useFakeTimers()
      const dir = mkdtempSync(join(tmpdir(), 'vicu-task-writes-outage-'))
      try {
        const queue = new OfflineQueue({ queuePath: join(dir, 'q.json'), attachmentsDir: join(dir, 'a') })
        queue.load()
        const sent: number[] = []
        const api = {
          async updateTask(id: number): Promise<ApiResult<unknown>> {
            sent.push(id)
            await new Promise((resolve) => setTimeout(resolve, 10_000))
            return err('Request timed out')
          },
        }
        const outcomes = Promise.all(
          [20, 21, 22, 23].map((id) => writeTask({ queue }, taskWrites.update(queue, api, id, { done: true }), { queue: true }))
        )
        await vi.advanceTimersByTimeAsync(10_000)
        expect((await outcomes).map((o) => o.kind)).toEqual(['queued', 'queued', 'queued', 'queued'])
        expect(sent).toEqual([20])
        expect(queue.counts().pending).toBe(4)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  it('writeTask sends the changes of a bulk edit one after the other', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vicu-task-writes-serial-'))
    try {
      const queue = new OfflineQueue({ queuePath: join(dir, 'q.json'), attachmentsDir: join(dir, 'a') })
      queue.load()
      let inFlight = 0
      let peak = 0
      const api = {
        async updateTask(id: number): Promise<ApiResult<unknown>> {
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise((resolve) => setTimeout(resolve, 3))
          inFlight--
          return ok({ id })
        },
      }
      const outcomes = await Promise.all(
        [10, 11, 12].map((id) => writeTask({ queue }, taskWrites.update(queue, api, id, { done: true }), { queue: true }))
      )
      expect(outcomes.map((o) => o.kind)).toEqual(['sent', 'sent', 'sent'])
      expect(peak).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
