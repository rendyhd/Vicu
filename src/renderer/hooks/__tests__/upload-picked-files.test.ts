import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { TaskAttachment } from '@/lib/vikunja-types'

const hoisted = vi.hoisted(() => ({
  upload: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { uploadPickedAttachment: hoisted.upload },
}))

import { sendPickedFiles } from '../use-task-mutations'
import { useUploadingStore, LANDED_KEEP_MS } from '@/stores/uploading-store'
import { uploadsToShow } from '@/lib/uploading-files'

const att = (id: number, name: string): TaskAttachment => ({
  id,
  task_id: 42,
  created: '2026-11-17T10:00:00Z',
  created_by: { id: 1, username: 'me' },
  file: { id, name, mime: 'application/pdf', size: 10, created: '2026-11-17T10:00:00Z' } as TaskAttachment['file'],
})

describe('sending the files picked in the attach dialog', () => {
  let qc: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    qc = new QueryClient()
    qc.setQueryData(['task-attachments', 42], [att(8, 'old.txt')])
    useUploadingStore.setState({ uploads: [], notice: null })
    hoisted.upload.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows every file as uploading at once and puts each attachment in the list as it lands', async () => {
    let finishFirst: (value: unknown) => void = () => {}
    hoisted.upload
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValueOnce({ success: true, data: { attachments: [att(10, 'b.png')] } })

    const sending = sendPickedFiles(qc, 42, [
      { token: 't1', name: 'report.pdf', size: 2_400_000 },
      { token: 't2', name: 'b.png', size: 5 },
    ])
    const list = () => qc.getQueryData<TaskAttachment[]>(['task-attachments', 42]) ?? []
    const shown = () => uploadsToShow(useUploadingStore.getState().uploads, 42, list()).map((u) => u.name)

    expect(shown()).toEqual(['report.pdf', 'b.png'])

    finishFirst({ success: true, data: { attachments: [att(9, 'report.pdf')] } })
    expect(await sending).toEqual({ count: 2, queued: [] })

    expect(list().map((a) => a.id)).toEqual([8, 9, 10])
    expect(shown()).toEqual([])
    expect(useUploadingStore.getState().notice).toEqual({ taskId: 42, text: 'b.png attached' })
    expect(hoisted.upload.mock.calls).toEqual([[42, 't1'], [42, 't2']])

    vi.advanceTimersByTime(LANDED_KEEP_MS + 1)
    expect(useUploadingStore.getState().uploads).toEqual([])
    expect(useUploadingStore.getState().notice).toBeNull()
  })

  it('a file kept for later or refused leaves its uploading row at once', async () => {
    hoisted.upload
      .mockResolvedValueOnce({ success: true, data: { attachments: [], queued: 'a.txt' } })
      .mockResolvedValueOnce({ success: false, error: 'The file is too big.' })

    const result = await sendPickedFiles(qc, 42, [
      { token: 't1', name: 'a.txt', size: 1 },
      { token: 't2', name: 'big.bin', size: 99 },
    ])

    expect(result).toEqual({ count: 0, queued: ['a.txt'] })
    expect(useUploadingStore.getState().uploads).toEqual([])
  })

  it('says why when no file went through', async () => {
    hoisted.upload.mockResolvedValueOnce({ success: false, error: 'The file is too big.' })

    await expect(sendPickedFiles(qc, 42, [{ token: 't1', name: 'big.bin', size: 99 }])).rejects.toThrow('The file is too big.')
    expect(useUploadingStore.getState().uploads).toEqual([])
  })
})
