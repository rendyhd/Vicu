import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { queueQuickEntryFollowUps } from '../offline/quick-actions'
import type { UploadAttachmentAction } from '../offline/types'

const png = (n = 4) => new Uint8Array(Array.from({ length: n }, (_, i) => i + 1))

describe('follow-ups of a Quick Entry create that did reach the server (D-QE-1 leftovers)', () => {
  let dir: string
  let queue: OfflineQueue
  let idCounter: number
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-follow-ups-'))
    idCounter = 0
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

  describe('enqueueUpload', () => {
    it('stores the image on disk and queues an upload for an existing task', async () => {
      const result = await queue.enqueueUpload(42, { name: 'shot.png', mime: 'image/png', bytes: png() }, { addImageToken: true })

      expect(result).toMatchObject({ taskId: 42, folded: false })
      const [action] = queue.getPending() as UploadAttachmentAction[]
      expect(action).toMatchObject({ type: 'upload-attachment', taskId: 42, name: 'shot.png', mime: 'image/png', addImageToken: true })
      expect(existsSync(join(dir, 'offline-attachments', action.file))).toBe(true)
    })

    it('leaves the image token out for a plain file attachment', async () => {
      await queue.enqueueUpload(42, { name: 'notes.pdf', mime: 'application/pdf', bytes: png() }, { addImageToken: false })
      expect((queue.getPending()[0] as UploadAttachmentAction).addImageToken).toBeUndefined()
    })

    it('refuses an image that is too large to keep offline', async () => {
      const big = { name: 'big.png', mime: 'image/png', bytes: new Uint8Array(26 * 1024 * 1024) }
      await expect(queue.enqueueUpload(42, big)).rejects.toThrow(/too large/)
      expect(queue.getPending()).toHaveLength(0)
    })

    it('refuses a task that is not known to the queue', async () => {
      await expect(queue.enqueueUpload(-5, { name: 'a.png', mime: 'image/png', bytes: png() })).rejects.toThrow(/not waiting/)
    })

    it('deletes the file when the action is discarded', async () => {
      await queue.enqueueUpload(42, { name: 'a.png', mime: 'image/png', bytes: png() })
      const action = queue.getPending()[0] as UploadAttachmentAction
      await queue.discardPending([action.id])
      expect(existsSync(join(dir, 'offline-attachments', action.file))).toBe(false)
    })
  })

  describe('enqueueCreate images', () => {
    it('adds the image token only to inline images, not to attached files', async () => {
      await queue.enqueueCreate({
        projectId: 3,
        fields: { title: 'With files' },
        images: [
          { name: 'pasted.png', mime: 'image/png', bytes: png() },
          { name: 'report.pdf', mime: 'application/pdf', bytes: png(), inline: false },
        ],
      })
      const uploads = queue.getPending().filter((a): a is UploadAttachmentAction => a.type === 'upload-attachment')
      expect(uploads.map((u) => [u.name, u.addImageToken])).toEqual([
        ['pasted.png', true],
        ['report.pdf', undefined],
      ])
    })
  })

  describe('queueQuickEntryFollowUps', () => {
    it('queues the labels by id or title and the images for the created task', async () => {
      const result = await queueQuickEntryFollowUps(queue, 42, {
        labels: [{ id: 3, title: 'Home' }, { title: 'Garden' }, { title: 'Garden' }],
        images: [{ name: 'shot.png', mime: 'image/png', bytes: png() }],
      }, 'Water plants')

      expect(result).toEqual({ success: true, labels: 2, images: 1 })
      expect(queue.getPending().map((a) => a.type)).toEqual(['add-label', 'add-label', 'upload-attachment'])
      expect(queue.getPending()[0]).toMatchObject({ taskId: 42, labelId: 3, title: 'Water plants' })
      expect(queue.getPending()[1]).toMatchObject({ taskId: 42, labelTitle: 'Garden' })
      expect(queue.getPending()[2]).toMatchObject({ taskId: 42, addImageToken: true })
    })

    it('ignores malformed entries from the window instead of queueing them', async () => {
      const result = await queueQuickEntryFollowUps(queue, 42, {
        labels: [{}, 'x', { id: -1 }] as never,
        images: [{ name: 'empty.png', mime: 'image/png', bytes: new Uint8Array() }] as never,
      })
      expect(result).toEqual({ success: true, labels: 0, images: 0 })
      expect(queue.getPending()).toHaveLength(0)
    })

    it('rejects a task id that is not a real task', async () => {
      const result = await queueQuickEntryFollowUps(queue, 0, { labels: [{ title: 'x' }] })
      expect(result.success).toBe(false)
    })

    it('reports a failure to store an image instead of throwing', async () => {
      const big = { name: 'big.png', mime: 'image/png', bytes: new Uint8Array(26 * 1024 * 1024) }
      const result = await queueQuickEntryFollowUps(queue, 42, { labels: [{ title: 'ok' }], images: [big] })
      expect(result.success).toBe(false)
      // What could be queued still was.
      expect(queue.getPending().map((a) => a.type)).toEqual(['add-label'])
    })
  })
})
