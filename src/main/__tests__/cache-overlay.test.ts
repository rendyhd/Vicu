import { describe, it, expect } from 'vitest'
import { overlayPendingActions } from '../cache-overlay'
import type { QueuedAction } from '../offline/types'

const NULL_DATE = '0001-01-01T00:00:00Z'
const base = [
  { id: 1, title: 'A', due_date: '2026-06-15T00:00:00Z', done: false },
  { id: 2, title: 'B', due_date: NULL_DATE, done: false },
]

const stamp = { createdAt: '2026-06-11T08:00:00Z', attempts: 0 }
const update = (id: string, taskId: number, patch: Record<string, unknown>): QueuedAction => ({ id, type: 'update', taskId, patch, ...stamp })

describe('overlayPendingActions', () => {
  it('hides tasks with a pending completion', () => {
    const out = overlayPendingActions(base, [update('p1', 1, { done: true })])
    expect(out.map((t: any) => t.id)).toEqual([2])
  })

  it('shows a task again when a later change reopens it', () => {
    const out = overlayPendingActions(base, [update('p1', 1, { done: true }), update('p2', 1, { done: false })])
    expect(out.map((t: any) => t.id)).toEqual([1, 2])
  })

  it('hides tasks with a pending delete', () => {
    const out = overlayPendingActions(base, [{ id: 'd1', type: 'delete', taskId: 2, ...stamp }])
    expect(out.map((t: any) => t.id)).toEqual([1])
  })

  it('applies a pending due date', () => {
    const out = overlayPendingActions(base, [update('p2', 2, { due_date: '2026-06-11T23:59:59Z' })])
    expect((out.find((t: any) => t.id === 2) as any).due_date).toBe('2026-06-11T23:59:59Z')
  })

  it('shows a pending cleared due date as the null date a cached row uses', () => {
    const out = overlayPendingActions(base, [update('p3', 1, { due_date: null })])
    expect((out.find((t: any) => t.id === 1) as any).due_date).toBe(NULL_DATE)
  })

  it('merges a pending edit over the cached row without touching other rows', () => {
    const out = overlayPendingActions(base, [update('p4', 1, { title: 'A2', priority: 3 })])
    expect(out.find((t: any) => t.id === 1)).toMatchObject({ title: 'A2', priority: 3, due_date: '2026-06-15T00:00:00Z' })
    expect(out.find((t: any) => t.id === 2)).toBe(base[1])
  })

  it('does not mutate the cached tasks', () => {
    const snapshot = JSON.stringify(base)
    overlayPendingActions(base, [update('p4', 1, { title: 'changed' })])
    expect(JSON.stringify(base)).toBe(snapshot)
  })

  describe('tasks created offline', () => {
    const create = (extra: Record<string, unknown> = {}): QueuedAction => ({
      id: 'p5',
      type: 'create',
      tempId: -1,
      projectId: 7,
      fields: { title: 'New offline task', description: 'notes', due_date: '2026-06-12T23:59:59Z', priority: 3, repeat_after: 86400, repeat_mode: 0 },
      createdAt: '2026-06-11T08:00:00Z',
      attempts: 0,
      ...extra,
    })

    it('appends a placeholder row with every field the user set, under the pending_ id', () => {
      const out = overlayPendingActions(base, [create()])
      const row = out.find((t: any) => t.id === 'pending_p5') as any
      expect(row).toMatchObject({
        title: 'New offline task', description: 'notes', due_date: '2026-06-12T23:59:59Z', priority: 3,
        repeat_after: 86400, project_id: 7, done: false, pending: true,
      })
    })

    it('does not list a task that was completed offline', () => {
      expect(overlayPendingActions(base, [create({ done: true })]).some((t: any) => t.id === 'pending_p5')).toBe(false)
    })

    it('applies follow-up changes that name the temp id', () => {
      const out = overlayPendingActions(base, [create(), update('p6', -1, { title: 'Renamed', due_date: null })])
      expect(out.find((t: any) => t.id === 'pending_p5')).toMatchObject({ title: 'Renamed', due_date: NULL_DATE })
    })

    it('drops the placeholder when a follow-up deletes it or completes it', () => {
      expect(overlayPendingActions(base, [create(), { id: 'd', type: 'delete', taskId: -1, ...stamp }]).some((t: any) => t.id === 'pending_p5')).toBe(false)
      expect(overlayPendingActions(base, [create(), update('c', -1, { done: true })]).some((t: any) => t.id === 'pending_p5')).toBe(false)
    })
  })
})
