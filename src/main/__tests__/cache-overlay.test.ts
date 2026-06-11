import { describe, it, expect } from 'vitest'
import { overlayPendingActions } from '../cache-overlay'

const NULL_DATE = '0001-01-01T00:00:00Z'
const base = [
  { id: 1, title: 'A', due_date: '2026-06-15T00:00:00Z', done: false },
  { id: 2, title: 'B', due_date: NULL_DATE, done: false },
]

describe('overlayPendingActions', () => {
  it('hides tasks with a pending complete', () => {
    const out = overlayPendingActions(base, [
      { id: 'p1', type: 'complete', createdAt: '', taskId: 1 },
    ])
    expect(out.map((t: any) => t.id)).toEqual([2])
  })

  it('applies a pending schedule-today due date', () => {
    const out = overlayPendingActions(base, [
      { id: 'p2', type: 'schedule-today', createdAt: '', taskId: 2, dueDate: '2026-06-11T23:59:59Z' },
    ])
    expect((out.find((t: any) => t.id === 2) as any).due_date).toBe('2026-06-11T23:59:59Z')
  })

  it('applies a pending remove-due-date', () => {
    const out = overlayPendingActions(base, [
      { id: 'p3', type: 'remove-due-date', createdAt: '', taskId: 1, dueDate: NULL_DATE },
    ])
    expect((out.find((t: any) => t.id === 1) as any).due_date).toBe(NULL_DATE)
  })

  it('merges pending update-task data over the cached row', () => {
    const out = overlayPendingActions(base, [
      { id: 'p4', type: 'update-task', createdAt: '', taskId: 1, taskData: { title: 'A2' } },
    ])
    expect((out.find((t: any) => t.id === 1) as any).title).toBe('A2')
  })

  it('appends pending creates as placeholder rows', () => {
    const out = overlayPendingActions(base, [
      { id: 'p5', type: 'create', createdAt: '2026-06-11T08:00:00Z', title: 'New offline task', projectId: 7 },
    ])
    const created = out.find((t: any) => t.id === 'pending_p5') as any
    expect(created).toBeDefined()
    expect(created.title).toBe('New offline task')
    expect(created.done).toBe(false)
  })
})
