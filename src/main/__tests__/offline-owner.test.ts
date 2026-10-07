import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { replayQueue, type ReplayApi } from '../offline/replay'
import { isSameOwner, normalizeServerUrl, type OfflineOwner } from '../offline/owner'
import type { ApiResult } from '../api-result'
import type { QueueData } from '../offline/types'

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })

describe('queue owner (server guard, D-SYNC-6 leftovers)', () => {
  describe('normalizeServerUrl', () => {
    it('lowercases the host and drops trailing slashes and fragments', () => {
      expect(normalizeServerUrl('https://Vikunja.Example.com/')).toBe('https://vikunja.example.com')
      expect(normalizeServerUrl('https://vikunja.example.com/sub//')).toBe('https://vikunja.example.com/sub')
      expect(normalizeServerUrl('  http://127.0.0.1:3456  ')).toBe('http://127.0.0.1:3456')
    })

    it('keeps text that is not a URL as it is, trimmed', () => {
      expect(normalizeServerUrl('not a url/')).toBe('not a url')
    })
  })

  describe('isSameOwner', () => {
    const a: OfflineOwner = { server: 'https://a.example', userId: 5 }

    it('matches the same server and the same user', () => {
      expect(isSameOwner(a, { server: 'https://a.example', userId: 5 })).toBe(true)
    })

    it('rejects another server', () => {
      expect(isSameOwner(a, { server: 'https://b.example', userId: 5 })).toBe(false)
    })

    it('rejects another user on the same server when both are known', () => {
      expect(isSameOwner(a, { server: 'https://a.example', userId: 6 })).toBe(false)
    })

    it('does not reject when one side does not know the user', () => {
      expect(isSameOwner(a, { server: 'https://a.example' })).toBe(true)
      expect(isSameOwner({ server: 'https://a.example' }, { server: 'https://a.example', userId: 9 })).toBe(true)
    })
  })

  describe('OfflineQueue', () => {
    let dir: string
    let queuePath: string
    let owner: OfflineOwner | null
    let idCounter: number
    let warn: ReturnType<typeof vi.spyOn>

    const make = () => {
      const q = new OfflineQueue({
        queuePath,
        attachmentsDir: join(dir, 'offline-attachments'),
        newId: () => `q${++idCounter}`,
        getOwner: () => owner,
      })
      q.load()
      return q
    }

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vicu-offline-owner-'))
      queuePath = join(dir, 'offline-queue.json')
      owner = { server: 'https://a.example', userId: 1 }
      idCounter = 0
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warn.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    })

    it('stamps every action with the server it was created for, and persists the stamp', async () => {
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 })
      await q.enqueueCreate({ projectId: 3, fields: { title: 'New' } })
      await q.enqueueDelete(8)

      for (const action of q.getPending()) expect(action.owner).toEqual({ server: 'https://a.example', userId: 1 })
      const onDisk = JSON.parse(readFileSync(queuePath, 'utf-8')) as QueueData
      expect(onDisk.actions.every((a) => a.owner?.server === 'https://a.example')).toBe(true)

      const reloaded = make()
      expect(reloaded.getPending().every((a) => a.owner?.userId === 1)).toBe(true)
    })

    it('stamps nothing when no server is configured', async () => {
      owner = null
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 })
      expect(q.getPending()[0].owner).toBeUndefined()
    })

    it('stampUnowned adopts actions an older build queued, without touching stamped ones', async () => {
      owner = null
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 })
      owner = { server: 'https://a.example' }
      await q.enqueueUpdate(6, { priority: 3 })
      owner = { server: 'https://b.example' }

      const changed = q.stampUnowned({ server: 'https://b.example' })

      expect(changed).toBe(1)
      expect(q.getPending().map((a) => a.owner?.server)).toEqual(['https://b.example', 'https://a.example'])
    })

    it('failForeign moves other-account actions to the failed log and keeps the rest pending', async () => {
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 }, { title: 'Pay rent' })
      owner = { server: 'https://b.example', userId: 2 }
      await q.enqueueUpdate(6, { priority: 3 })

      const moved = await q.failForeign()

      expect(moved).toBe(1)
      expect(q.getPending()).toHaveLength(1)
      expect(q.getPending()[0]).toMatchObject({ type: 'update', taskId: 6 })
      const failed = q.snapshot().failed
      expect(failed).toHaveLength(1)
      expect(failed[0]).toMatchObject({ type: 'update', reason: 'other-account', taskId: 5 })
      expect(failed[0].error).toContain('https://a.example')
    })

    it('failForeign fails the follow-ups of a foreign create with it', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 3, fields: { title: 'Buy milk' }, labels: [{ title: 'home' }] })
      owner = { server: 'https://b.example' }

      expect(await q.failForeign()).toBe(2)

      expect(q.getPending()).toHaveLength(0)
      expect(q.snapshot().failed.map((f) => f.reason).sort()).toEqual(['other-account', 'other-account'])
    })

    it('failForeign does nothing without a configured server, or when everything matches', async () => {
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 })
      expect(await q.failForeign()).toBe(0)
      owner = null
      expect(await q.failForeign()).toBe(0)
      expect(q.getPending()).toHaveLength(1)
    })

    it('retrying a failed other-account action puts it back in the queue (it fails again until the account matches)', async () => {
      const q = make()
      await q.enqueueUpdate(5, { priority: 2 })
      owner = { server: 'https://b.example' }
      await q.failForeign()

      await q.retryFailed()
      expect(q.getPending()).toHaveLength(1)

      owner = { server: 'https://a.example', userId: 1 }
      expect(await q.failForeign()).toBe(0)
      expect(q.getPending()).toHaveLength(1)
    })

    it('reads an old queue file without owners', () => {
      writeFileSync(queuePath, JSON.stringify({
        version: 1,
        actions: [{ id: 'old', type: 'update', createdAt: '2026-01-01T00:00:00.000Z', attempts: 0, taskId: 5, patch: { done: true } }],
        failed: [],
        resolved: {},
        lastTempId: 0,
      }))
      const q = make()
      expect(q.getPending()).toHaveLength(1)
      expect(q.getPending()[0].owner).toBeUndefined()
    })
  })

  describe('replay', () => {
    let dir: string
    let owner: OfflineOwner | null
    let warn: ReturnType<typeof vi.spyOn>

    const api = (): { api: ReplayApi; updateTask: ReturnType<typeof vi.fn> } => {
      const updateTask = vi.fn(async () => ok({}))
      const unused = vi.fn(async () => ok({}))
      return {
        updateTask,
        api: {
          createTask: unused,
          updateTask,
          deleteTask: unused,
          addLabelToTask: unused,
          removeLabelFromTask: unused,
          fetchLabels: async () => ok([]),
          createLabel: unused,
          uploadTaskAttachment: unused,
          fetchTaskAttachments: async () => ok([]),
          fetchTaskById: unused,
          findRecentCreate: async () => ok(null),
        } as unknown as ReplayApi,
      }
    }

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vicu-offline-owner-replay-'))
      owner = { server: 'https://a.example' }
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warn.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    })

    it('does not send actions queued for another server and keeps them in the failed log', async () => {
      const q = new OfflineQueue({
        queuePath: join(dir, 'offline-queue.json'),
        attachmentsDir: join(dir, 'att'),
        getOwner: () => owner,
      })
      q.load()
      await q.enqueueUpdate(5, { priority: 2 })
      owner = { server: 'https://b.example' }
      await q.enqueueUpdate(6, { priority: 3 })
      const fake = api()

      const event = await replayQueue(q, fake.api)

      expect(fake.updateTask).toHaveBeenCalledTimes(1)
      expect(fake.updateTask).toHaveBeenCalledWith(6, { priority: 3 })
      expect(event.applied).toBe(1)
      expect(event.failed).toBe(1)
      expect(q.snapshot().failed[0]).toMatchObject({ reason: 'other-account', taskId: 5 })
    })

    it('does not block anything while the current server is unknown', async () => {
      const q = new OfflineQueue({
        queuePath: join(dir, 'offline-queue.json'),
        attachmentsDir: join(dir, 'att'),
        getOwner: () => owner,
      })
      q.load()
      await q.enqueueUpdate(5, { priority: 2 })
      owner = null
      const fake = api()

      await replayQueue(q, fake.api)

      expect(q.getPending()).toHaveLength(0)
      expect(fake.updateTask).toHaveBeenCalledTimes(1)
    })
  })
})
