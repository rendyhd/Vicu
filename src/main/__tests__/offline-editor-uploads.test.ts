import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OfflineQueue } from '../offline/queue'
import { taskWrites, writeTask } from '../offline/task-writes'
import type { ApiResult } from '../api-result'
import { queuedUploadsText, waitingUploadStatus, waitingUploadsFor } from '../../renderer/lib/waiting-uploads'

// Issue 104: a file added in the task's editor while the server cannot be reached waits in the
// offline queue instead of failing, and the attachment list shows it waiting or refused.

const ok = <T>(data: T): ApiResult<T> => ({ success: true, data })
const err = (error: string, statusCode?: number): ApiResult<never> => ({ success: false, error, statusCode })

describe('editor uploads and the offline queue', () => {
  let dir: string
  let queue: OfflineQueue
  let ids: number
  let sent: string[]
  let answer: () => ApiResult<unknown>

  const api = {
    async uploadTaskAttachment(taskId: number, bytes: Buffer, name: string): Promise<ApiResult<unknown>> {
      sent.push(`${taskId} ${name} ${bytes.length}`)
      return answer()
    },
  }
  const file = { bytes: new Uint8Array([1, 2, 3, 4]), name: 'IMG_2031.png', mime: 'image/png' }
  const upload = (inline = false) =>
    writeTask({ queue }, taskWrites.upload(queue, api, 5, file, { inline, title: 'Fix the porch light' }), { queue: true })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vicu-editor-uploads-'))
    ids = 0
    sent = []
    answer = () => ok({ success: [{ id: 9 }] })
    queue = new OfflineQueue({
      queuePath: join(dir, 'offline-queue.json'),
      attachmentsDir: join(dir, 'offline-attachments'),
      newId: () => `q${++ids}`,
    })
    queue.load()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('uploads at once when the server answers', async () => {
    const outcome = await upload()
    expect(outcome.kind).toBe('sent')
    expect(sent).toEqual(['5 IMG_2031.png 4'])
    expect(queue.getPending()).toHaveLength(0)
  })

  it('keeps the file in the queue when the server cannot be reached, with the image going into the notes', async () => {
    answer = () => err('net::ERR_INTERNET_DISCONNECTED')
    const outcome = await upload(true)
    expect(outcome).toEqual({ kind: 'queued', reason: 'unreachable', enqueued: expect.anything() })
    expect(queue.getPending()).toHaveLength(1)
    expect(queue.getPending()[0]).toMatchObject({ type: 'upload-attachment', taskId: 5, name: 'IMG_2031.png', addImageToken: true })
  })

  it('does not queue an upload that may have reached the server', async () => {
    answer = () => err('The server reported an error', 500)
    expect((await upload()).kind).toBe('refused')
    expect(queue.getPending()).toHaveLength(0)
  })

  it('shows the waiting file in the task attachments, and the refused one with its reason', async () => {
    answer = () => err('net::ERR_INTERNET_DISCONNECTED')
    await upload()
    const waiting = waitingUploadsFor(queue.snapshot(), 5)
    expect(waiting).toEqual([{ id: 'q1', name: 'IMG_2031.png', inline: false, failed: false, canRetry: true }])
    expect(waitingUploadStatus(waiting[0])).toBe('Waiting to upload')
    expect(waitingUploadsFor(queue.snapshot(), 6)).toEqual([])

    const refused = waitingUploadsFor(
      {
        ...queue.snapshot(),
        pending: [],
        failed: [
          { id: 'q1', type: 'upload-attachment', summary: '', error: 'Request entity too large', statusCode: 413, reason: 'too-large', failedAt: '', taskId: 5, upload: { name: 'site-video.mp4', inline: false } },
        ],
      },
      5
    )
    expect(refused[0].canRetry).toBe(false)
    expect(waitingUploadStatus(refused[0])).toBe('Not uploaded: more than the server accepts')
  })

  it('says one name or a count in the toast', () => {
    expect(queuedUploadsText(['IMG_2031.png'])).toBe("IMG_2031.png uploads when you're back online")
    expect(queuedUploadsText(['a.pdf', 'b.pdf'])).toBe("2 files upload when you're back online")
  })
})
