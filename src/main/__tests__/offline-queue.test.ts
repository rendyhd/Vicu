import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue, FAILED_RETENTION_MS, MAX_FAILED_ENTRIES, MAX_QUEUED_IMAGE_BYTES } from '../offline/queue'
import { backupPathFor } from '../atomic-file'
import type { CreateAction, QueueData } from '../offline/types'

describe('OfflineQueue', () => {
  let dir: string
  let queuePath: string
  let attachmentsDir: string
  let clock: number
  let idCounter: number
  let warn: ReturnType<typeof vi.spyOn>

  const make = () => {
    const q = new OfflineQueue({
      queuePath,
      attachmentsDir,
      now: () => new Date(clock++ * 1000),
      newId: () => `q${++idCounter}`,
    })
    q.load()
    return q
  }
  const onDisk = (): QueueData => JSON.parse(readFileSync(queuePath, 'utf-8'))
  const pngBytes = (n = 8) => new Uint8Array(Array.from({ length: n }, (_, i) => i))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-offline-queue-'))
    queuePath = join(dir, 'offline-queue.json')
    attachmentsDir = join(dir, 'offline-attachments')
    clock = 1_800_000_000 // an arbitrary start; each read advances one second
    idCounter = 0
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('updates are stored as merge patches, never snapshots (D-SYNC-2)', () => {
    it('complete / uncomplete store only { done }', async () => {
      const q = make()
      await q.enqueueComplete(5, true)
      expect(q.getPending()).toMatchObject([{ type: 'update', taskId: 5, patch: { done: true } }])
      await q.enqueueComplete(5, false)
      expect(q.getPending()).toHaveLength(1)
      expect(q.getPending()[0]).toMatchObject({ patch: { done: false } })
    })

    it('stores a due date change as { due_date } and a removal as { due_date: null }', async () => {
      const q = make()
      await q.enqueueUpdate(5, { due_date: '2026-10-07T23:59:59.000Z' })
      expect(q.getPending()[0]).toMatchObject({ patch: { due_date: '2026-10-07T23:59:59.000Z' } })
      await q.enqueueUpdate(5, { due_date: '0001-01-01T00:00:00Z' })
      expect(q.getPending()[0]).toMatchObject({ patch: { due_date: null } })
    })

    it('drops read-only and unknown fields so a cached task cannot leak in as a patch', async () => {
      const q = make()
      await q.enqueueUpdate(5, {
        id: 5, created: 'x', updated: 'y', labels: [{ id: 1 }], related_tasks: {}, position: 3,
        title: 'New title', done: false,
      })
      expect(q.getPending()[0]).toMatchObject({ patch: { title: 'New title', done: false } })
      expect(Object.keys((q.getPending()[0] as { patch: object }).patch).sort()).toEqual(['done', 'title'])
    })

    it('an update with nothing writable in it queues nothing', async () => {
      const q = make()
      const result = await q.enqueueUpdate(5, { id: 5, created: 'x' })
      expect(result.folded).toBe(true)
      expect(q.counts()).toEqual({ pending: 0, failed: 0 })
    })

    it('merges later updates of the same task into one action', async () => {
      const q = make()
      await q.enqueueUpdate(5, { title: 'a', priority: 3 })
      const second = await q.enqueueUpdate(5, { priority: 0, due_date: null })
      expect(second.folded).toBe(true)
      expect(q.getPending()).toHaveLength(1)
      expect(q.getPending()[0]).toMatchObject({ patch: { title: 'a', priority: 0, due_date: null } })
    })
  })

  describe('persistence', () => {
    it('writes the queue compactly and reloads the same actions', async () => {
      const q = make()
      await q.enqueueUpdate(5, { done: true }, { title: 'Pay rent' })
      await q.enqueueDelete(6)

      expect(readFileSync(queuePath, 'utf-8')).not.toContain('\n')
      const reloaded = make()
      expect(reloaded.getPending()).toEqual(q.getPending())
      expect(reloaded.loadStatus).toBe('ok')
    })

    it('counts a task created offline as one change, whatever rides along with it', async () => {
      const q = make()
      await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'x' },
        labels: [{ id: 1 }, { title: 'two' }],
        images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }],
      })
      expect(q.getPending()).toHaveLength(4)
      expect(q.counts().pending).toBe(1)
      await q.enqueueComplete(5, true)
      expect(q.counts().pending).toBe(2)
    })

    it('counts come from memory, not from re-parsing the file', async () => {
      const q = make()
      await q.enqueueUpdate(5, { done: true })
      writeFileSync(queuePath, '{broken') // would throw or reset if counts re-read the file
      expect(q.counts()).toEqual({ pending: 1, failed: 0 })
      expect(q.snapshot().pending).toHaveLength(1)
    })

    it('loads the backup when the queue file does not parse, instead of an empty queue', async () => {
      const q = make()
      await q.enqueueUpdate(5, { done: true })
      await q.enqueueUpdate(6, { done: true }) // the second write leaves the first version as .bak
      writeFileSync(queuePath, '{"version":1,"actions":[')

      const recovered = make()
      expect(recovered.loadStatus).toBe('recovered')
      expect(recovered.getPending().map((a) => (a as { taskId: number }).taskId)).toEqual([5])
      expect(existsSync(backupPathFor(queuePath))).toBe(true)
    })

    it('reports a corrupt queue with no backup and keeps the file aside', async () => {
      writeFileSync(queuePath, 'not json at all')
      const q = make()
      expect(q.loadStatus).toBe('corrupt')
      expect(q.snapshot().loadStatus).toBe('corrupt')
      expect(q.counts()).toEqual({ pending: 0, failed: 0 })
      expect(readdirSync(dir).some((n) => n.startsWith('offline-queue.json.corrupt-'))).toBe(true)
    })

    it('skips one malformed action but keeps the rest', () => {
      writeFileSync(
        queuePath,
        JSON.stringify({
          version: 1,
          actions: [
            { id: 'ok', type: 'update', taskId: 5, patch: { done: true }, createdAt: 'x', attempts: 0 },
            { id: 'bad', type: 'update', taskId: 'five', patch: {} },
            { id: 'weird', type: 'teleport' },
          ],
        })
      )
      const q = make()
      expect(q.getPending().map((a) => a.id)).toEqual(['ok'])
    })

    it('50 concurrent enqueues all land, in order, in one valid file', async () => {
      const q = make()
      await Promise.all(Array.from({ length: 50 }, (_, i) => q.enqueueUpdate(1000 + i, { done: true })))
      const reloaded = make()
      expect(reloaded.getPending().map((a) => (a as { taskId: number }).taskId)).toEqual(Array.from({ length: 50 }, (_, i) => 1000 + i))
    })

    it('flush waits for pending writes', async () => {
      const q = make()
      void q.enqueueUpdate(5, { done: true })
      await q.flush()
      expect(q.hasUnsavedChanges).toBe(false)
      expect(onDisk().actions).toHaveLength(1)
    })

    it('notifies listeners on every change', async () => {
      const q = make()
      const listener = vi.fn()
      q.onChange(listener)
      await q.enqueueUpdate(5, { done: true })
      await q.enqueueDelete(6)
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  describe('creates keep every field the user set (D-SYNC-3, D-QE-1)', () => {
    it('stores title, description, due date, priority, recurrence, reminders and project', async () => {
      const q = make()
      const reminders = [{ reminder: '2026-10-07T09:00:00Z' }, { relative_period: -3600, relative_to: 'due_date' }]
      const result = await q.enqueueCreate({
        projectId: 7,
        fields: {
          title: 'Water plants',
          description: '<p>front room</p>',
          due_date: '2026-10-08T14:30:00.000Z',
          priority: 3,
          repeat_after: 604800,
          repeat_mode: 0,
          reminders,
        },
      })

      expect(result.tempId).toBeLessThan(0)
      expect(result.pendingId).toBe(`pending_${result.actionId}`)
      expect(q.getPending()).toHaveLength(1)
      expect(q.getPending()[0]).toMatchObject({
        type: 'create',
        projectId: 7,
        tempId: result.tempId,
        fields: {
          title: 'Water plants',
          description: '<p>front room</p>',
          due_date: '2026-10-08T14:30:00.000Z',
          priority: 3,
          repeat_after: 604800,
          repeat_mode: 0,
          reminders,
        },
      })
    })

    it('does not put done, project_id or empty dates into the create fields', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 7, fields: { title: 'x', done: true, project_id: 99, due_date: '0001-01-01T00:00:00Z' } })
      const create = q.getPending()[0] as CreateAction
      expect(create.fields).toEqual({ title: 'x' })
      expect(create.projectId).toBe(7)
    })

    it('refuses a create without a title or project', async () => {
      const q = make()
      await expect(q.enqueueCreate({ projectId: 7, fields: { title: '   ' } })).rejects.toThrow(/title/i)
      await expect(q.enqueueCreate({ projectId: 0, fields: { title: 'x' } })).rejects.toThrow(/project/i)
      expect(q.counts().pending).toBe(0)
    })

    it('hands out temp ids that count down and never repeat, even after a restart', async () => {
      const q = make()
      const a = await q.enqueueCreate({ projectId: 7, fields: { title: 'a' } })
      const b = await q.enqueueCreate({ projectId: 7, fields: { title: 'b' } })
      expect([a.tempId, b.tempId]).toEqual([-1, -2])

      const reloaded = make()
      const c = await reloaded.enqueueCreate({ projectId: 7, fields: { title: 'c' } })
      expect(c.tempId).toBe(-3)
    })

    it('a completed create carries done', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, done: true })
      expect((q.getPending()[0] as CreateAction).done).toBe(true)
    })
  })

  describe('labels become follow-up actions bound to the temp id', () => {
    it('queues one add-label per label after the create, by id or by title', async () => {
      const q = make()
      const { tempId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'Pack' },
        labels: [{ id: 3 }, { title: 'Travel' }, { id: 3 }, { title: 'travel' }, {}],
      })

      expect(q.getPending().map((a) => a.type)).toEqual(['create', 'add-label', 'add-label'])
      expect(q.getPending()[1]).toMatchObject({ taskId: tempId, labelId: 3 })
      expect(q.getPending()[2]).toMatchObject({ taskId: tempId, labelTitle: 'Travel' })
    })

    it('a label added later to a pending task is bound to the same temp id', async () => {
      const q = make()
      const { tempId, pendingId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'Pack' } })
      await q.enqueueAddLabel(pendingId, { title: 'Home' })
      expect(q.getPending()[1]).toMatchObject({ type: 'add-label', taskId: tempId, labelTitle: 'Home' })
    })
  })

  describe('pasted images are stored on disk and queued as uploads', () => {
    it('writes each image under offline-attachments and queues an upload bound to the temp id', async () => {
      const q = make()
      const { tempId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'Screenshot' },
        images: [
          { name: 'image.png', mime: 'image/png', bytes: pngBytes(10) },
          { name: '../../evil name.png', mime: 'image/png', bytes: pngBytes(4) },
        ],
      })

      const uploads = q.getPending().filter((a) => a.type === 'upload-attachment')
      expect(uploads).toHaveLength(2)
      expect(uploads[0]).toMatchObject({ taskId: tempId, name: 'image.png', mime: 'image/png', addImageToken: true })
      expect((uploads[1] as { name: string }).name).not.toContain('..')
      for (const u of uploads) {
        const file = (u as { file: string }).file
        expect(file).toMatch(/^[a-f0-9]{16}\.bin$/)
        expect(existsSync(join(attachmentsDir, file))).toBe(true)
      }
      // The bytes are not in the queue file.
      expect(readFileSync(queuePath, 'utf-8').length).toBeLessThan(3000)
    })

    it('refuses an image that is too large, leaving nothing behind', async () => {
      const q = make()
      await expect(
        q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'huge.png', mime: 'image/png', bytes: new Uint8Array(MAX_QUEUED_IMAGE_BYTES + 1) }] })
      ).rejects.toThrow(/too large/i)
      expect(q.counts().pending).toBe(0)
      expect(existsSync(attachmentsDir) ? readdirSync(attachmentsDir) : []).toEqual([])
    })

    it('refuses images that are too large together, leaving nothing behind', async () => {
      const q = make()
      const big = () => ({ name: 'big.png', mime: 'image/png', bytes: new Uint8Array(MAX_QUEUED_IMAGE_BYTES) })
      await expect(
        q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [big(), big(), big(), big(), { name: 'one more.png', mime: 'image/png', bytes: new Uint8Array(1) }] })
      ).rejects.toThrow(/together/i)
      expect(q.counts().pending).toBe(0)
      expect(existsSync(attachmentsDir) ? readdirSync(attachmentsDir) : []).toEqual([])
    })

    it('replaces an unusable mime type', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a', mime: 'not a mime', bytes: pngBytes() }] })
      expect(q.getPending()[1]).toMatchObject({ mime: 'application/octet-stream' })
    })

    it('sweeps image files nothing refers to at startup, keeping referenced ones', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }] })
      const orphan = await q.files.save(pngBytes())
      const keptFile = (q.getPending()[1] as { file: string }).file

      const reloaded = make()
      expect(await reloaded.sweepOrphans()).toBe(1)
      expect(existsSync(join(attachmentsDir, orphan))).toBe(false)
      expect(existsSync(join(attachmentsDir, keptFile))).toBe(true)
    })
  })

  describe('edits and deletes of a pending create fold into it (Android QueueMerge)', () => {
    it('update + create = create with merged fields, addressed by temp id or pending_x', async () => {
      const q = make()
      const { tempId, pendingId, actionId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'Draft', priority: 1 } })

      const byTemp = await q.enqueueUpdate(tempId, { title: 'Final' })
      const byPending = await q.enqueueUpdate(pendingId, { due_date: '2026-10-09T23:59:59.000Z' })

      expect(byTemp).toMatchObject({ taskId: tempId, folded: true, actionId })
      expect(byPending).toMatchObject({ taskId: tempId, folded: true, actionId })
      expect(q.getPending()).toHaveLength(1)
      expect((q.getPending()[0] as CreateAction).fields).toEqual({ title: 'Final', priority: 1, due_date: '2026-10-09T23:59:59.000Z' })
    })

    it('completing a pending create makes it a create with done (D-SYNC-4)', async () => {
      const q = make()
      const { pendingId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'x' } })
      await q.enqueueComplete(pendingId, true)
      expect(q.getPending()).toHaveLength(1)
      expect((q.getPending()[0] as CreateAction).done).toBe(true)
    })

    it('the undo of that completion takes it back out', async () => {
      const q = make()
      const { pendingId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'x' } })
      await q.enqueueComplete(pendingId, true)
      expect(await q.cancelChange(pendingId, ['done'])).toBe(true)
      expect((q.getPending()[0] as CreateAction).done).toBeFalsy()
    })

    it('delete + create = both removed, with their labels and their image files', async () => {
      const q = make()
      const { tempId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'x' },
        labels: [{ id: 1 }],
        images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }],
      })
      const keep = await q.enqueueUpdate(50, { done: true })
      const file = (q.getPending().find((a) => a.type === 'upload-attachment') as { file: string }).file
      expect(existsSync(join(attachmentsDir, file))).toBe(true)

      const result = await q.enqueueDelete(tempId)

      expect(result.folded).toBe(true)
      expect(q.getPending().map((a) => a.id)).toEqual([keep.actionId])
      expect(existsSync(join(attachmentsDir, file))).toBe(false)
      expect(onDisk().actions).toHaveLength(1)
    })

    it('an unknown pending id is refused, not silently queued', async () => {
      const q = make()
      await expect(q.enqueueUpdate('pending_nope', { done: true })).rejects.toThrow(/not waiting/i)
      await expect(q.enqueueUpdate(-77, { done: true })).rejects.toThrow(/not waiting/i)
      await expect(q.enqueueUpdate('banana', { done: true })).rejects.toThrow(/not waiting/i)
    })
  })

  describe('replaying a create (completeAction) remaps every follow-up', () => {
    it('rewrites temp ids in chained actions and resolves late references to the real id', async () => {
      const q = make()
      const { tempId, pendingId, actionId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'Pack' },
        labels: [{ title: 'Travel' }],
        images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }],
      })
      // Work on the task while its create is being sent: it cannot fold, it queues behind.
      q.beginSend(actionId)
      await q.enqueueUpdate(tempId, { priority: 4 })
      await q.enqueueDelete(99)

      await q.completeAction(actionId, { realId: 321 })
      q.endSend()

      expect(q.getPending().map((a) => [a.type, (a as { taskId: number }).taskId])).toEqual([
        ['add-label', 321],
        ['upload-attachment', 321],
        ['update', 321],
        ['delete', 99],
      ])

      // A window that still holds the temp id (or the Quick View row id) keeps working.
      expect(q.resolveTaskRef(tempId)).toBe(321)
      expect(q.resolveTaskRef(pendingId)).toBe(321)
      await q.enqueueComplete(pendingId, true)
      expect(q.getPending().find((a) => a.type === 'update' && (a as { patch: { done?: boolean } }).patch.done === true)).toMatchObject({ taskId: 321 })

      // ...and that survives a restart.
      expect(make().resolveTaskRef(tempId)).toBe(321)
    })

    it('a create completed offline gets a follow-up update that runs right after it', async () => {
      const q = make()
      const { actionId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, done: true, labels: [{ id: 1 }] })
      await q.completeAction(actionId, { realId: 500 })
      expect(q.getPending().map((a) => a.type)).toEqual(['update', 'add-label'])
      expect(q.getPending()[0]).toMatchObject({ taskId: 500, patch: { done: true } })
    })

    it('deletes the image file once its upload action is completed', async () => {
      const q = make()
      await q.enqueueCreate({ projectId: 7, fields: { title: 'x' }, images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }] })
      const upload = q.getPending()[1] as { id: string; file: string }
      expect(existsSync(join(attachmentsDir, upload.file))).toBe(true)
      await q.completeAction(upload.id)
      expect(existsSync(join(attachmentsDir, upload.file))).toBe(false)
    })
  })

  describe('actions being sent (in flight)', () => {
    it('are not folded into: a second update queues behind the first', async () => {
      const q = make()
      const first = await q.enqueueComplete(5, true)
      q.beginSend(first.actionId)
      const second = await q.enqueueComplete(5, false)
      expect(second.folded).toBe(false)
      expect(q.getPending()).toHaveLength(2)
    })

    it('cannot be cancelled by an undo: the caller must queue the opposite change (D-SYNC-4)', async () => {
      const q = make()
      const first = await q.enqueueComplete(5, true)
      q.beginSend(first.actionId)
      expect(await q.cancelChange(5, ['done'])).toBe(false)
      expect(q.getPending()).toHaveLength(1)
    })

    it('an action discarded while it waits is no longer queued, so it is not sent', async () => {
      const q = make()
      const a = await q.enqueueUpdate(5, { title: 'a' })
      const b = await q.enqueueUpdate(6, { title: 'b' })
      expect(q.isQueued(b.actionId)).toBe(true)
      await q.discardPending([b.actionId])
      expect(q.isQueued(b.actionId)).toBe(false)
      expect(q.beginSend(b.actionId)).toBe(false)
      expect(q.isQueued(a.actionId)).toBe(true)
    })
  })

  describe('failed log', () => {
    it('moves an action to the failed log with its error and a summary', async () => {
      const q = make()
      const a = await q.enqueueComplete(5, true, { title: 'Pay rent' })
      await q.failAction(a.actionId, { error: 'validation failed', statusCode: 422, reason: 'rejected' })

      expect(q.counts()).toEqual({ pending: 0, failed: 1 })
      const [entry] = q.snapshot().failed
      expect(entry).toMatchObject({ id: a.actionId, type: 'update', error: 'validation failed', statusCode: 422, reason: 'rejected' })
      expect(entry.summary).toBe('Complete "Pay rent"')
      expect(onDisk().failed).toHaveLength(1)
    })

    it('a failed create takes the actions that depend on it along, flagged as dependent', async () => {
      const q = make()
      const { tempId, actionId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'Pack' },
        labels: [{ id: 1 }],
        images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }],
      })
      await q.enqueueUpdate(50, { done: true })

      await q.failAction(actionId, { error: 'Not found', statusCode: 404, reason: 'not-found' })

      expect(q.getPending().map((a) => a.type)).toEqual(['update'])
      const failed = q.snapshot().failed
      expect(failed.map((f) => [f.type, f.reason])).toEqual([
        ['create', 'not-found'],
        ['add-label', 'dependency-failed'],
        ['upload-attachment', 'dependency-failed'],
      ])
      expect(new Set(failed.map((f) => f.groupId))).toEqual(new Set([actionId]))
      // The image is kept: the user can still retry.
      const file = (q.getFailed()[2].action as { file: string }).file
      expect(existsSync(join(attachmentsDir, file))).toBe(true)
      // Nothing can be queued for a task that was never created.
      await expect(q.enqueueUpdate(tempId, { done: true })).rejects.toThrow(/not waiting/i)
    })

    it('retry puts the whole group back in its original order with fresh attempts', async () => {
      const q = make()
      const { actionId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'Pack' }, labels: [{ id: 1 }] })
      await q.enqueueUpdate(50, { done: true })
      await q.recordAttempt(actionId)
      await q.failAction(actionId, { error: 'boom', statusCode: 422, reason: 'rejected' })

      // Retrying just the create brings its dependents too.
      expect(await q.retryFailed([actionId])).toBe(2)

      expect(q.getPending().map((a) => a.type)).toEqual(['create', 'add-label', 'update'])
      expect(q.getPending().every((a) => a.attempts === 0)).toBe(true)
      expect(q.counts().failed).toBe(0)
    })

    it('discard removes entries and deletes their image files', async () => {
      const q = make()
      const { actionId } = await q.enqueueCreate({
        projectId: 7,
        fields: { title: 'x' },
        images: [{ name: 'a.png', mime: 'image/png', bytes: pngBytes() }],
      })
      const file = (q.getPending()[1] as { file: string }).file
      await q.failAction(actionId, { error: 'no', statusCode: 400, reason: 'rejected' })

      expect(await q.discardFailed()).toBe(2)
      expect(q.counts()).toEqual({ pending: 0, failed: 0 })
      expect(existsSync(join(attachmentsDir, file))).toBe(false)
    })

    it('forgets entries older than the retention window and keeps the log bounded', async () => {
      const q = make()
      const first = await q.enqueueUpdate(1, { done: true })
      await q.failAction(first.actionId, { error: 'x', statusCode: 400, reason: 'rejected' })

      clock += FAILED_RETENTION_MS / 1000 + 10
      const second = await q.enqueueUpdate(2, { done: true })
      await q.failAction(second.actionId, { error: 'y', statusCode: 400, reason: 'rejected' })
      expect(q.getFailed().map((f) => f.id)).toEqual([second.actionId])

      for (let i = 0; i < MAX_FAILED_ENTRIES + 5; i++) {
        const a = await q.enqueueUpdate(100 + i, { done: true })
        await q.failAction(a.actionId, { error: 'z', statusCode: 400, reason: 'rejected' })
      }
      expect(q.getFailed()).toHaveLength(MAX_FAILED_ENTRIES)
    })

    it('counts attempts per action', async () => {
      const q = make()
      const a = await q.enqueueUpdate(1, { done: true })
      expect(await q.recordAttempt(a.actionId)).toBe(1)
      expect(await q.recordAttempt(a.actionId)).toBe(2)
      expect(q.snapshot().pending[0].attempts).toBe(2)
    })
  })

  describe('snapshot', () => {
    it('describes pending work in one line each and exposes the pending create', async () => {
      const q = make()
      const { pendingId, tempId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'Buy milk', priority: 2 } })
      await q.enqueueAddLabel(tempId, { title: 'Home' })
      await q.enqueueComplete(12, true, { title: 'Pay rent' })
      await q.enqueueUpdate(13, { due_date: null }, { title: 'Call mum' })

      const snap = q.snapshot()
      expect(snap.pending.map((p) => p.summary)).toEqual([
        'Create "Buy milk"',
        'Add label "Home" to "Buy milk"',
        'Complete "Pay rent"',
        'Remove the due date from "Call mum"',
      ])
      expect(snap.pending[0].create).toMatchObject({ tempId, pendingId, projectId: 7, fields: { title: 'Buy milk', priority: 2 }, done: false })
      expect(snap.replaying).toBe(false)
      expect(snap.authProblem).toBeNull()
    })

    it('names follow-ups after their create, also after a rename and once the task has a real id', async () => {
      const q = make()
      const { pendingId, actionId } = await q.enqueueCreate({ projectId: 7, fields: { title: 'Pack' }, labels: [{ title: 'Travel' }] })
      await q.enqueueUpdate(pendingId, { title: 'Pack bags' })
      expect(q.snapshot().pending.map((p) => p.summary)).toEqual(['Create "Pack bags"', 'Add label "Travel" to "Pack bags"'])

      await q.completeAction(actionId, { realId: 77 })
      expect(q.snapshot().pending.map((p) => p.summary)).toEqual(['Add label "Travel" to "Pack bags"'])
    })

    it('tracks an auth problem until it is cleared', () => {
      const q = make()
      q.setAuthProblem('Session expired. Please sign in again.')
      expect(q.snapshot().authProblem).toMatchObject({ error: 'Session expired. Please sign in again.' })
      q.setAuthProblem(null)
      expect(q.snapshot().authProblem).toBeNull()
    })
  })

  describe('labels', () => {
    it('add then remove of the same label cancels out', async () => {
      const q = make()
      await q.enqueueAddLabel(5, { id: 3 })
      const result = await q.enqueueRemoveLabel(5, 3)
      expect(result.folded).toBe(true)
      expect(q.counts().pending).toBe(0)
    })

    it('a label needs an id or a title', async () => {
      const q = make()
      await expect(q.enqueueAddLabel(5, {})).rejects.toThrow(/label/i)
    })
  })
})
