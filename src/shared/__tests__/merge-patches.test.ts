import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NULL_DATE,
  PROJECT_WRITABLE_FIELDS,
  TASK_READ_ONLY_FIELDS,
  TASK_WRITABLE_FIELDS,
  projectPatch,
  sanitizeProjectPatch,
  sanitizeTaskPatch,
  taskPatch,
} from '../merge-patches'

// Ported from vicu-android MergePatchesTest.kt, adapted to desktop's snake_case tasks.

const baseTask = {
  id: 24,
  title: 'Persistence regression',
  description: 'Initial description',
  done: false,
  priority: 4,
  due_date: '2026-07-25T21:59:59Z',
  start_date: NULL_DATE,
  end_date: NULL_DATE,
  project_id: 7,
  repeat_after: 0,
  repeat_mode: 0,
  hex_color: '',
  percent_done: 0,
  bucket_id: 0,
  reminders: [] as Array<Record<string, unknown>>,
  labels: [{ id: 3, title: 'x' }],
  created: '2026-07-24T12:00:00Z',
  updated: '2026-07-24T12:00:00Z',
}

describe('taskPatch', () => {
  it('issue 24 edit changes only description and priority', () => {
    const patch = taskPatch(baseTask, { ...baseTask, description: 'Persisted description', priority: 2 })

    expect(Object.keys(patch).sort()).toEqual(['description', 'priority'])
    expect(patch.description).toBe('Persisted description')
    expect(patch.priority).toBe(2)
    expect('title' in patch).toBe(false)
    expect('due_date' in patch).toBe(false)
  })

  it('preserves explicit false, zero, empty string and null', () => {
    const original = { ...baseTask, id: 99, description: 'non-empty', done: true, due_date: '2026-08-01T10:00:00Z', priority: 3 }

    const patch = taskPatch(original, { ...original, description: '', done: false, due_date: '', priority: 0 })

    expect(patch.description).toBe('')
    expect(patch.done).toBe(false)
    expect(patch.due_date).toBeNull()
    expect(patch.priority).toBe(0)
  })

  it('sets both recurrence fields together', () => {
    const patch = taskPatch(baseTask, { ...baseTask, repeat_after: 604_800, repeat_mode: 2 })

    expect(Object.keys(patch).sort()).toEqual(['repeat_after', 'repeat_mode'])
    expect(patch.repeat_after).toBe(604_800)
    expect(patch.repeat_mode).toBe(2)
  })

  it('patches both recurrence halves even when only one changed', () => {
    const original = { ...baseTask, repeat_after: 86_400, repeat_mode: 0 }

    const patch = taskPatch(original, { repeat_mode: 1 })

    expect(patch).toEqual({ repeat_after: 86_400, repeat_mode: 1 })
  })

  it('clears recurrence with explicit zeroes', () => {
    const original = { ...baseTask, repeat_after: 604_800, repeat_mode: 2 }

    const patch = taskPatch(original, { ...original, repeat_after: 0, repeat_mode: 0 })

    expect(patch).toEqual({ repeat_after: 0, repeat_mode: 0 })
  })

  it('never contains response-only fields', () => {
    const patch = taskPatch(null, {
      ...baseTask,
      done_at: '2026-07-24T13:00:00Z',
      position: 65_536,
      related_tasks: { subtask: [{ id: 5 }] },
      attachments: [{ id: 1 }],
      created_by: { id: 1 },
      identifier: '#1',
      index: 1,
      kanban_position: 0,
      max_permission: 2,
    } as Record<string, unknown>)

    for (const key of TASK_READ_ONLY_FIELDS) expect(key in patch).toBe(false)
    expect('labels' in patch).toBe(false)
    expect('id' in patch).toBe(false)
  })

  it('sends only the fields that differ, never the whole task', () => {
    const patch = taskPatch(baseTask, { ...baseTask })
    expect(patch).toEqual({})
  })

  it('diffs only what the caller changed when the edit is partial', () => {
    const patch = taskPatch(baseTask, { project_id: 9 })
    expect(patch).toEqual({ project_id: 9 })
  })

  it('sends every defined writable field when there is no original', () => {
    const patch = taskPatch(null, { title: 'New', priority: 0, done: false })
    expect(patch).toEqual({ title: 'New', priority: 0, done: false })
  })

  it('omits undefined fields', () => {
    expect(taskPatch(baseTask, { title: undefined, priority: 1 })).toEqual({ priority: 1 })
  })

  it('treats the null date, an empty string and null as the same empty date', () => {
    const original = { ...baseTask, due_date: NULL_DATE }
    expect(taskPatch(original, { due_date: '' })).toEqual({})
    expect(taskPatch(original, { due_date: null })).toEqual({})
    expect(taskPatch(original, { due_date: NULL_DATE })).toEqual({})
  })

  it('clears a date with an explicit null', () => {
    expect(taskPatch(baseTask, { due_date: NULL_DATE })).toEqual({ due_date: null })
    expect(taskPatch(baseTask, { start_date: NULL_DATE })).toEqual({})
    const withStart = { ...baseTask, start_date: '2026-07-20T09:00:00Z' }
    expect(taskPatch(withStart, { start_date: '' })).toEqual({ start_date: null })
  })

  it('does not patch a date that is the same instant in another format', () => {
    const original = { ...baseTask, due_date: '2026-07-25T22:00:00Z' }
    expect(taskPatch(original, { due_date: '2026-07-25T22:00:00.000Z' })).toEqual({})
    expect(taskPatch(original, { due_date: '2026-07-26T22:00:00.000Z' }))
      .toEqual({ due_date: '2026-07-26T22:00:00.000Z' })
  })

  it('compares and sends hex colors without the leading hash', () => {
    const original = { ...baseTask, hex_color: 'ff0000' }
    expect(taskPatch(original, { hex_color: '#ff0000' })).toEqual({})
    expect(taskPatch(original, { hex_color: '#00ff00' })).toEqual({ hex_color: '00ff00' })
  })

  it('includes a field the original did not carry (partial embedded subtask)', () => {
    const partial = { id: 5, title: 'Child' }
    expect(taskPatch(partial, { priority: 2 })).toEqual({ priority: 2 })
    expect(taskPatch(partial, { done: true })).toEqual({ done: true })
  })

  it('sends a completion as just done', () => {
    expect(taskPatch(baseTask, { ...baseTask, done: true })).toEqual({ done: true })
  })
})

describe('taskPatch reminders', () => {
  it('relative reminder patch omits a blank reminder date', () => {
    const original = { ...baseTask, id: 30, due_date: '2026-10-05T09:00:00Z' }

    const patch = taskPatch(original, {
      ...original,
      reminders: [{ reminder: '', relative_period: -900, relative_to: 'due_date' }],
    })

    expect(patch.reminders).toEqual([{ relative_period: -900, relative_to: 'due_date' }])
  })

  it('treats the null date as a blank reminder date', () => {
    const patch = taskPatch(baseTask, {
      reminders: [{ reminder: NULL_DATE, relative_period: -60, relative_to: 'due_date' }],
    })
    expect(patch.reminders).toEqual([{ relative_period: -60, relative_to: 'due_date' }])
  })

  it('absolute reminder patch omits a blank relative_to', () => {
    const patch = taskPatch(baseTask, {
      reminders: [{ reminder: '2026-10-05T08:00:00Z', relative_period: 0, relative_to: '' }],
    })

    expect(patch.reminders).toEqual([{ reminder: '2026-10-05T08:00:00Z', relative_period: 0 }])
  })

  it('keeps both halves of a reminder created by the desktop picker', () => {
    const reminder = { reminder: '2026-10-05T08:45:00.000Z', relative_period: -900, relative_to: 'due_date' }
    expect(taskPatch(baseTask, { reminders: [reminder] }).reminders).toEqual([reminder])
  })

  it('never sends reminder as an empty string', () => {
    const patch = taskPatch(baseTask, {
      reminders: [
        { reminder: '', relative_period: -900, relative_to: 'due_date' },
        { reminder: '2026-10-05T08:00:00Z', relative_period: 0, relative_to: '' },
        { reminder: '' },
      ],
    })

    expect(JSON.stringify(patch)).not.toContain('"reminder":""')
    // A reminder with neither a date nor a relative anchor carries nothing to schedule.
    expect(patch.reminders).toHaveLength(2)
  })

  it('drops unknown keys from reminders (the schema forbids extra properties)', () => {
    const patch = taskPatch(baseTask, {
      reminders: [{ reminder: '2026-10-05T08:00:00Z', id: 4, task_id: 9, created: 'x' }],
    })
    expect(patch.reminders).toEqual([{ reminder: '2026-10-05T08:00:00Z' }])
  })

  it('clears reminders with an empty array and treats null like empty', () => {
    const original = { ...baseTask, reminders: [{ reminder: '2026-10-05T08:00:00Z', relative_period: 0 }] }
    expect(taskPatch(original, { reminders: [] })).toEqual({ reminders: [] })
    expect(taskPatch(original, { reminders: null })).toEqual({ reminders: [] })
    expect(taskPatch(baseTask, { reminders: null })).toEqual({})
  })

  it('does not resend unchanged reminders', () => {
    const reminders = [{ reminder: '2026-10-05T08:00:00Z', relative_period: 0, relative_to: '' }]
    const original = { ...baseTask, reminders }
    expect(taskPatch(original, { ...original, reminders: reminders.map((r) => ({ ...r })) })).toEqual({})
  })

  it('sends the full list when a reminder is added', () => {
    const existing = { reminder: '2026-10-05T08:00:00Z', relative_period: 0, relative_to: '' }
    const original = { ...baseTask, reminders: [existing] }
    const added = { reminder: '2026-10-06T08:00:00Z' }

    expect(taskPatch(original, { reminders: [existing, added] }).reminders).toEqual([
      { reminder: '2026-10-05T08:00:00Z', relative_period: 0 },
      { reminder: '2026-10-06T08:00:00Z' },
    ])
  })
})

describe('sanitizeTaskPatch', () => {
  it('keeps writable fields and drops server-owned task fields', () => {
    expect(sanitizeTaskPatch({
      id: 42,
      title: 'Keep title',
      description: 'Persist these notes',
      priority: 3,
      due_date: '2030-01-15T12:00:00Z',
      labels: [{ id: 7 }],
      position: 65536,
      created: '2026-07-24T10:00:00Z',
      created_by: { id: 1, username: 'owner' },
      children: [],
    })).toEqual({
      title: 'Keep title',
      description: 'Persist these notes',
      priority: 3,
      due_date: '2030-01-15T12:00:00Z',
    })
  })

  it('cleans legacy queued patches: blank reminder fields and the null date', () => {
    const legacy = {
      due_date: NULL_DATE,
      reminders: [
        { reminder: '', relative_period: -900, relative_to: 'due_date' },
        { reminder: '2026-10-05T08:00:00Z', relative_period: 0, relative_to: '' },
      ],
    }

    expect(sanitizeTaskPatch(legacy)).toEqual({
      due_date: null,
      reminders: [
        { relative_period: -900, relative_to: 'due_date' },
        { reminder: '2026-10-05T08:00:00Z', relative_period: 0 },
      ],
    })
  })
})

describe('projectPatch', () => {
  const project = {
    id: 1,
    title: 'Before',
    description: 'Keep description',
    hex_color: '3498db',
    parent_project_id: 3,
    position: 65_536,
    is_archived: false,
    is_favorite: false,
    identifier: '',
    created: 'server-owned',
  }

  it('contains only changed writable fields', () => {
    expect(projectPatch(project, { ...project, title: 'After' })).toEqual({ title: 'After' })
  })

  it('archive patch changes only archive state', () => {
    expect(projectPatch(project, { ...project, is_archived: true })).toEqual({ is_archived: true })
  })

  it('review patch changes only the description', () => {
    expect(projectPatch(project, { ...project, description: 'Keep description\n<!-- reviewed -->' }))
      .toEqual({ description: 'Keep description\n<!-- reviewed -->' })
  })

  it('reorder patch changes only the position', () => {
    expect(projectPatch(project, { position: 32_768 })).toEqual({ position: 32_768 })
  })

  it('sends parent_project_id only when it changes', () => {
    expect(projectPatch(project, { ...project, parent_project_id: 3, title: 'After' })).toEqual({ title: 'After' })
    expect(projectPatch(project, { parent_project_id: 0 })).toEqual({ parent_project_id: 0 })
    expect(projectPatch({ ...project, parent_project_id: 0 }, { parent_project_id: 0, title: 'After' }))
      .toEqual({ title: 'After' })
  })

  it('never contains children or any key outside the PATCH schema', () => {
    const treeNode = {
      ...project,
      children: [{ ...project, id: 2, children: [] }],
      views: [{ id: 9 }],
      owner: { id: 1 },
      max_permission: 2,
      updated: 'x',
    }

    const full = projectPatch(null, treeNode)
    const diff = projectPatch(project, { ...treeNode, description: 'changed' })

    for (const patch of [full, diff, sanitizeProjectPatch(treeNode)]) {
      expect('children' in patch).toBe(false)
      for (const key of Object.keys(patch)) {
        expect(PROJECT_WRITABLE_FIELDS as readonly string[]).toContain(key)
      }
    }
    expect(diff).toEqual({ description: 'changed' })
  })

  it('compares and sends hex colors without the leading hash', () => {
    expect(projectPatch(project, { hex_color: '#3498db' })).toEqual({})
    expect(projectPatch(project, { hex_color: '#ff0000' })).toEqual({ hex_color: 'ff0000' })
  })

  it('preserves explicit false, zero and empty string', () => {
    const archived = { ...project, is_archived: true, description: 'text', position: 5 }
    expect(projectPatch(archived, { is_archived: false, description: '', position: 0 }))
      .toEqual({ is_archived: false, description: '', position: 0 })
  })
})

describe('writable field lists match the Vikunja API schema', () => {
  const docs = JSON.parse(readFileSync(resolve(__dirname, '../../../api-docs.json'), 'utf8')) as {
    paths: Record<string, Record<string, { requestBody?: { content?: Record<string, { schema: { properties?: Record<string, { readOnly?: boolean }>; additionalProperties?: boolean } }> } }>>
  }

  const mergePatchSchema = (path: string) =>
    docs.paths[path].patch?.requestBody?.content?.['application/merge-patch+json']?.schema

  it('every task field is a writable property of the task PATCH body', () => {
    const schema = mergePatchSchema('/tasks/{projecttask}')
    expect(schema?.additionalProperties).toBe(false)
    for (const field of TASK_WRITABLE_FIELDS) {
      expect(schema?.properties?.[field], field).toBeDefined()
      expect(schema?.properties?.[field]?.readOnly, field).not.toBe(true)
    }
  })

  it('every project field is a writable property of the project PATCH body', () => {
    const schema = mergePatchSchema('/projects/{id}')
    expect(schema?.additionalProperties).toBe(false)
    for (const field of PROJECT_WRITABLE_FIELDS) {
      expect(schema?.properties?.[field], field).toBeDefined()
      expect(schema?.properties?.[field]?.readOnly, field).not.toBe(true)
    }
  })
})
