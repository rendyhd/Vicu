import { describe, expect, it } from 'vitest'
import {
  buildTaskAttachmentDownloadUrl,
  buildProjectCollectionUrl,
  createProjectPatch,
  createTaskCollectionSearchParams,
  createTaskPatch,
  finishTaskCollection,
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

  it('does not promote a child whose omitted parent is completed', () => {
    const child = {
      id: 2,
      title: 'Child',
      related_tasks: { parenttask: [{ id: 1, title: 'Parent', done: true }] },
    }

    expect(withoutNestedSubtasks([child])).toEqual([])
  })
})

describe('finishTaskCollection', () => {
  const parent = { id: 1, title: 'Parent', related_tasks: { subtask: [{ id: 2 }] } }
  const child = { id: 2, title: 'Child', related_tasks: { parenttask: [{ id: 1 }] } }

  it('hides nested subtasks by default', () => {
    expect(finishTaskCollection([parent, child], {})).toEqual([parent])
    expect(finishTaskCollection([parent, child], { filter: 'done = false' })).toEqual([parent])
  })

  it('keeps every task when the caller will filter first (Tag view, custom lists)', () => {
    expect(finishTaskCollection([parent, child], { keep_nested_subtasks: true })).toEqual([parent, child])
  })

  it('does not send the option to the server', () => {
    const query = createTaskCollectionSearchParams({ filter: 'done = false', keep_nested_subtasks: true })
    expect([...query.keys()].sort()).toEqual(['expand', 'filter'])
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

  it('preserves explicit false and zero values while omitting undefined', () => {
    expect(createTaskPatch({
      done: false,
      priority: 0,
      reminders: null,
      description: undefined,
    })).toEqual({
      done: false,
      priority: 0,
      reminders: [],
    })
  })

  it('turns the null date into an explicit null and drops blank reminder fields', () => {
    expect(createTaskPatch({
      due_date: '0001-01-01T00:00:00Z',
      reminders: [{ reminder: '', relative_period: -900, relative_to: 'due_date' }],
    })).toEqual({
      due_date: null,
      reminders: [{ relative_period: -900, relative_to: 'due_date' }],
    })
  })
})

describe('createProjectPatch', () => {
  it('drops children and every other key outside the PATCH schema', () => {
    expect(createProjectPatch({
      id: 5,
      title: 'Renamed',
      description: 'notes',
      children: [{ id: 6 }],
      views: [],
      owner: { id: 1 },
      created: 'x',
      parent_project_id: 0,
      position: 1024,
      is_archived: false,
    })).toEqual({
      title: 'Renamed',
      description: 'notes',
      parent_project_id: 0,
      position: 1024,
      is_archived: false,
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
