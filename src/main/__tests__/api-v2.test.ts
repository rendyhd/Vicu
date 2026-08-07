import { describe, expect, it } from 'vitest'
import {
  buildTaskAttachmentDownloadUrl,
  buildProjectCollectionUrl,
  createTaskCollectionSearchParams,
  createTaskPatch,
  withoutNestedSubtasks,
} from '../api-v2'

describe('project collection URL', () => {
  it('requests archived projects only when the complete snapshot is needed', () => {
    expect(buildProjectCollectionUrl('https://vikunja.example/', true))
      .toBe('https://vikunja.example/api/v2/projects?is_archived=true')
    expect(buildProjectCollectionUrl('https://vikunja.example/', false))
      .toBe('https://vikunja.example/api/v2/projects')
  })
})

describe('task hierarchy', () => {
  it('requests complete subtask hierarchies for task collections', () => {
    const params = createTaskCollectionSearchParams({
      q: 'needle',
      filter: 'done = false',
      page: 2,
    })

    expect(params.getAll('expand')).toEqual(['subtasks'])
    expect(params.get('q')).toBe('needle')
    expect(params.get('filter')).toBe('done = false')
    expect(params.get('page')).toBe('2')
  })

  it('keeps a child nested when its parent is in the same result', () => {
    const parent = { id: 1, title: 'Parent', related_tasks: { subtask: [{ id: 2 }] } }
    const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

    expect(withoutNestedSubtasks([parent, child])).toEqual([parent])
  })

  it('keeps a matching child visible when its parent is outside the result', () => {
    const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

    expect(withoutNestedSubtasks([child])).toEqual([child])
  })
})

describe('createTaskPatch', () => {
  it('keeps writable issue #24 fields and drops server-owned task fields', () => {
    expect(createTaskPatch({
      id: 42,
      title: 'Keep title',
      description: 'Persist these notes',
      priority: 3,
      due_date: '2030-01-15T12:00:00Z',
      labels: [{ id: 7 }],
      position: 65536,
      created: '2026-07-24T10:00:00Z',
      created_by: { id: 1, username: 'owner' },
    })).toEqual({
      title: 'Keep title',
      description: 'Persist these notes',
      priority: 3,
      due_date: '2030-01-15T12:00:00Z',
    })
  })

  it('preserves explicit false, zero, and null values while omitting undefined', () => {
    expect(createTaskPatch({
      done: false,
      priority: 0,
      reminders: null,
      description: undefined,
    })).toEqual({
      done: false,
      priority: 0,
      reminders: null,
    })
  })
})

describe('buildTaskAttachmentDownloadUrl', () => {
  it('builds the original attachment URL without a preview size', () => {
    expect(buildTaskAttachmentDownloadUrl('https://vikunja.example/', 42, 7))
      .toBe('https://vikunja.example/api/v2/tasks/42/attachments/7')
  })

  it('requests a bounded server-side image preview', () => {
    expect(buildTaskAttachmentDownloadUrl('https://vikunja.example/base', 42, 7, 'lg'))
      .toBe('https://vikunja.example/base/api/v2/tasks/42/attachments/7?preview_size=lg')
  })
})
