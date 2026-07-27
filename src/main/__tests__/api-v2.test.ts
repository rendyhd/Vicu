import { describe, expect, it } from 'vitest'
import { buildTaskAttachmentDownloadUrl, createTaskPatch } from '../api-v2'

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
