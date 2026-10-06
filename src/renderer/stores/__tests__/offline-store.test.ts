import { beforeEach, describe, expect, it } from 'vitest'
import { countPending, useOfflineStore } from '../offline-store'
import { syncStatusLabel } from '@/components/sync/SyncStatusButton'
import type { OfflineQueueItemView, OfflineQueueSnapshot } from '../../../shared/offline-queue-types'

const item = (overrides: Partial<OfflineQueueItemView>): OfflineQueueItemView => ({
  id: 'a1',
  type: 'update',
  summary: 'Update',
  createdAt: '2026-10-07T00:00:00.000Z',
  attempts: 0,
  ...overrides,
})

const snapshot = (overrides: Partial<OfflineQueueSnapshot> = {}): OfflineQueueSnapshot => ({
  pending: [],
  failed: [],
  replaying: false,
  authProblem: null,
  loadStatus: 'ok',
  ...overrides,
})

describe('offline store', () => {
  beforeEach(() => {
    useOfflineStore.getState().setSnapshot(snapshot())
  })

  it('counts a task created offline as one change however many labels ride along', () => {
    const create = item({
      id: 'c1',
      type: 'create',
      taskId: -1,
      create: { tempId: -1, pendingId: 'pending_c1', projectId: 1, fields: { title: 'New' }, done: false },
    })
    const label = item({ id: 'l1', type: 'add-label', taskId: -1 })
    const image = item({ id: 'u1', type: 'upload-attachment', taskId: -1 })
    const edit = item({ id: 'e1', type: 'update', taskId: 7 })
    expect(countPending(snapshot({ pending: [create, label, image, edit] }))).toBe(2)
  })

  it('counts a label added to an existing task as its own change', () => {
    expect(countPending(snapshot({ pending: [item({ type: 'add-label', taskId: 7 })] }))).toBe(1)
  })

  it('tracks which tasks have waiting or failed changes', () => {
    useOfflineStore.getState().setSnapshot(
      snapshot({
        pending: [item({ taskId: 7 }), item({ id: 'a2', taskId: -3 })],
        failed: [
          {
            id: 'f1',
            type: 'update',
            summary: 'Update',
            error: 'gone',
            reason: 'not-found',
            failedAt: '2026-10-07T00:00:00.000Z',
            taskId: 9,
          },
        ],
      }),
    )
    const state = useOfflineStore.getState()
    expect([...state.pendingTaskIds].sort()).toEqual([-3, 7])
    expect([...state.failedTaskIds]).toEqual([9])
    expect(state.counts).toEqual({ pending: 2, failed: 1 })
  })

  it('applies a change event without touching the task id sets', () => {
    useOfflineStore.getState().setSnapshot(snapshot({ pending: [item({ taskId: 7 })] }))
    useOfflineStore.getState().applyChange({
      counts: { pending: 0, failed: 0 },
      replaying: true,
      authProblem: null,
    })
    const state = useOfflineStore.getState()
    expect(state.counts).toEqual({ pending: 0, failed: 0 })
    expect(state.replaying).toBe(true)
    expect(state.pendingTaskIds.has(7)).toBe(true)
  })
})

describe('sync status label', () => {
  it('is empty when everything is synced', () => {
    expect(syncStatusLabel({ pending: 0, failed: 0 }, false)).toBe('')
  })

  it('lists the auth problem first, then failed, then waiting', () => {
    expect(syncStatusLabel({ pending: 2, failed: 1 }, true)).toBe('Sign in needed · 1 failed · 2 waiting')
    expect(syncStatusLabel({ pending: 3, failed: 0 }, false)).toBe('3 waiting')
  })
})
