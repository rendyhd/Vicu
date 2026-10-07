import { describe, expect, it, vi } from 'vitest'
import { applyQuickEntryFollowUps, type FollowUpApi } from '../quick-entry-follow-ups'

const ok = { success: true as const }
const network = { success: false as const, error: 'net::ERR_INTERNET_DISCONNECTED' }
const rejected = { success: false as const, error: 'Validation failed', statusCode: 422 }
const bytes = new Uint8Array([1, 2, 3])

function fakeApi(overrides: Partial<{ [K in keyof FollowUpApi]: ReturnType<typeof vi.fn> }> = {}) {
  const api = {
    addLabelToTask: vi.fn(async () => ok),
    createLabel: vi.fn(async () => ({ success: true as const, data: { id: 77 } })),
    uploadAttachment: vi.fn(async () => ok),
    fetchTaskAttachments: vi.fn(async () => ({ success: true as const, data: [{ id: 901 }, { id: 902 }] })),
    updateTask: vi.fn(async () => ok),
    queueFollowUps: vi.fn(async () => ({ success: true as const })),
    ...overrides,
  }
  return api as typeof api & FollowUpApi
}

const input = (extra: Partial<Parameters<typeof applyQuickEntryFollowUps>[1]> = {}) => ({
  taskId: 42,
  title: 'Water plants',
  description: '',
  labels: [],
  images: [],
  ...extra,
})

describe('applyQuickEntryFollowUps (labels and images after an online create)', () => {
  it('applies labels and images online and queues nothing when every call works', async () => {
    const api = fakeApi()

    const outcome = await applyQuickEntryFollowUps(api, input({
      labels: [{ id: 3, title: 'Home' }, { title: 'Garden' }],
      images: [{ name: 'a.png', mime: 'image/png', bytes }],
    }))

    expect(api.addLabelToTask).toHaveBeenCalledWith(42, 3)
    expect(api.createLabel).toHaveBeenCalledWith({ title: 'Garden' })
    expect(api.addLabelToTask).toHaveBeenCalledWith(42, 77)
    expect(api.uploadAttachment).toHaveBeenCalledWith(42, bytes, 'a.png', 'image/png')
    expect(api.updateTask).toHaveBeenCalledWith(42, { description: '[[image:901]]\n[[image:902]]' })
    expect(api.queueFollowUps).not.toHaveBeenCalled()
    expect(outcome).toEqual({ queuedLabels: 0, queuedImages: 0, dropped: 0 })
  })

  it('queues a label whose add call failed with a network error, by id', async () => {
    const api = fakeApi({ addLabelToTask: vi.fn(async () => network) })

    const outcome = await applyQuickEntryFollowUps(api, input({ labels: [{ id: 3, title: 'Home' }] }))

    expect(api.queueFollowUps).toHaveBeenCalledWith(42, { labels: [{ id: 3, title: 'Home' }], images: [] }, 'Water plants')
    expect(outcome.queuedLabels).toBe(1)
  })

  it('queues a label that could not be created because the server was unreachable, by title', async () => {
    const api = fakeApi({ createLabel: vi.fn(async () => network) })

    await applyQuickEntryFollowUps(api, input({ labels: [{ title: 'Garden' }] }))

    expect(api.addLabelToTask).not.toHaveBeenCalled()
    expect(api.queueFollowUps).toHaveBeenCalledWith(42, { labels: [{ title: 'Garden' }], images: [] }, 'Water plants')
  })

  it('queues the add of a freshly created label by id and title when only the add failed', async () => {
    const api = fakeApi({ addLabelToTask: vi.fn(async () => ({ success: false as const, error: 'Bad gateway', statusCode: 502 })) })

    await applyQuickEntryFollowUps(api, input({ labels: [{ title: 'Garden' }] }))

    expect(api.queueFollowUps).toHaveBeenCalledWith(42, { labels: [{ id: 77, title: 'Garden' }], images: [] }, 'Water plants')
  })

  it('does not queue what the server rejected: that would fail again for the same reason', async () => {
    const api = fakeApi({ addLabelToTask: vi.fn(async () => rejected), uploadAttachment: vi.fn(async () => rejected) })

    const outcome = await applyQuickEntryFollowUps(api, input({
      labels: [{ id: 3, title: 'Home' }],
      images: [{ name: 'a.png', mime: 'image/png', bytes }],
    }))

    expect(api.queueFollowUps).not.toHaveBeenCalled()
    expect(outcome).toEqual({ queuedLabels: 0, queuedImages: 0, dropped: 2 })
  })

  it('queues an image whose upload could not reach the server and still patches the tokens of the ones that went through', async () => {
    const uploadAttachment = vi.fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(network)
    const api = fakeApi({ uploadAttachment, fetchTaskAttachments: vi.fn(async () => ({ success: true as const, data: [{ id: 901 }] })) })
    const second = new Uint8Array([9, 9])

    const outcome = await applyQuickEntryFollowUps(api, input({
      description: 'notes',
      images: [{ name: 'a.png', mime: 'image/png', bytes }, { name: 'b.png', mime: 'image/png', bytes: second }],
    }))

    expect(api.updateTask).toHaveBeenCalledWith(42, { description: 'notes\n[[image:901]]' })
    expect(api.queueFollowUps).toHaveBeenCalledWith(42, { labels: [], images: [{ name: 'b.png', mime: 'image/png', bytes: second }] }, 'Water plants')
    expect(outcome.queuedImages).toBe(1)
  })

  it('leaves the description alone when no image went through', async () => {
    const api = fakeApi({ uploadAttachment: vi.fn(async () => network) })

    await applyQuickEntryFollowUps(api, input({ images: [{ name: 'a.png', mime: 'image/png', bytes }] }))

    expect(api.fetchTaskAttachments).not.toHaveBeenCalled()
    expect(api.updateTask).not.toHaveBeenCalled()
    expect(api.queueFollowUps).toHaveBeenCalledTimes(1)
  })

  it('treats a call that throws like a failed one and keeps going', async () => {
    const api = fakeApi({
      addLabelToTask: vi.fn()
        .mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'))
        .mockResolvedValueOnce(ok),
    })

    const outcome = await applyQuickEntryFollowUps(api, input({ labels: [{ id: 3, title: 'Home' }, { id: 4, title: 'Work' }] }))

    expect(api.addLabelToTask).toHaveBeenCalledTimes(2)
    expect(outcome.queuedLabels).toBe(1)
  })

  it('reports it when the queue itself could not take the follow-ups', async () => {
    const api = fakeApi({
      addLabelToTask: vi.fn(async () => network),
      queueFollowUps: vi.fn(async () => ({ success: false as const, error: 'Could not save offline: disk full' })),
    })

    const outcome = await applyQuickEntryFollowUps(api, input({ labels: [{ id: 3, title: 'Home' }] }))

    expect(outcome.queueError).toBe('Could not save offline: disk full')
  })
})
