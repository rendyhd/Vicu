import { describe, it, expect } from 'vitest'
import { actionToRequest } from '../sync-logic'

const NULL_DATE = '0001-01-01T00:00:00Z'

describe('actionToRequest', () => {
  it('maps a create action to a create request with only set fields', () => {
    const req = actionToRequest({
      id: 'a1', type: 'create', createdAt: '2026-06-10T10:00:00Z',
      title: 'Buy milk', description: null, dueDate: null, projectId: 7,
    })
    expect(req).toEqual({ kind: 'create', projectId: 7, payload: { title: 'Buy milk' } })
  })

  it('includes description and due_date on create when present', () => {
    const req = actionToRequest({
      id: 'a2', type: 'create', createdAt: '2026-06-10T10:00:00Z',
      title: 'Call dentist', description: 'ask about Friday', dueDate: '2026-06-12T23:59:59Z', projectId: 7,
    })
    expect(req).toEqual({
      kind: 'create', projectId: 7,
      payload: { title: 'Call dentist', description: 'ask about Friday', due_date: '2026-06-12T23:59:59Z' },
    })
  })

  it('skips a create with no project id', () => {
    const req = actionToRequest({ id: 'a3', type: 'create', createdAt: '', title: 'x', projectId: null })
    expect(req).toEqual({ kind: 'skip' })
  })

  it('maps complete to an update that preserves stored task data and sets done', () => {
    const taskData = { id: 5, title: 'T', due_date: '2026-06-12T00:00:00Z', priority: 3 }
    const req = actionToRequest({ id: 'a4', type: 'complete', createdAt: '', taskId: 5, taskData })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { ...taskData, done: true } })
  })

  it('maps uncomplete to done false', () => {
    const req = actionToRequest({ id: 'a5', type: 'uncomplete', createdAt: '', taskId: 5, taskData: { id: 5, title: 'T' } })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', done: false } })
  })

  it('maps schedule-today using the stored dueDate', () => {
    const req = actionToRequest({
      id: 'a6', type: 'schedule-today', createdAt: '', taskId: 5,
      taskData: { id: 5, title: 'T' }, dueDate: '2026-06-10T23:59:59Z',
    })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', due_date: '2026-06-10T23:59:59Z' } })
  })

  it('maps remove-due-date to the Vikunja null date', () => {
    const req = actionToRequest({
      id: 'a7', type: 'remove-due-date', createdAt: '', taskId: 5,
      taskData: { id: 5, title: 'T' }, dueDate: NULL_DATE,
    })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'T', due_date: NULL_DATE } })
  })

  it('maps update-task to the stored taskData verbatim', () => {
    const req = actionToRequest({ id: 'a8', type: 'update-task', createdAt: '', taskId: 5, taskData: { id: 5, title: 'New' } })
    expect(req).toEqual({ kind: 'update', taskId: 5, payload: { id: 5, title: 'New' } })
  })

  it('skips unknown action types and updates without a taskId', () => {
    expect(actionToRequest({ id: 'a9', type: 'mystery', createdAt: '' })).toEqual({ kind: 'skip' })
    expect(actionToRequest({ id: 'a10', type: 'complete', createdAt: '' })).toEqual({ kind: 'skip' })
  })
})
