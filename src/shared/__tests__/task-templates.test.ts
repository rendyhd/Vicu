import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  captureTemplate,
  encodeTemplate,
  isTemplateTooLarge,
  MAX_TEMPLATE_BYTES,
  readTemplate,
  readTemplates,
  relativeReminders,
  templateDueDate,
  templateKey,
  templateProject,
  withSubtaskTitles,
  type TaskTemplate,
  type TemplateSource,
} from '../task-templates'

interface FixtureSource {
  title: string
  project_id?: number
  notes?: string
  label_ids?: number[]
  priority?: number
  due?: string
  repeat_after?: number
  repeat_mode?: number
  reminders?: Array<{ relative_period?: number; relative_to?: string }>
  subtasks?: FixtureSource[]
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test-fixtures', 'cross-app-semantics-v1.json'), 'utf8')) as {
  taskTemplates: {
    capture: Array<{ name: string; today: string; task: FixtureSource; expect: TaskTemplate }>
    apply: Array<{
      name: string
      today: string
      projects: number[]
      labels: number[]
      fallback_project: number
      template: TaskTemplate
      expect: { title: string; project_id: number; due: string | null; label_ids: number[]; reminders: unknown[] }
    }>
    read: Array<{ name: string; value: unknown; isTemplate: boolean }>
  }
}

const toSource = (task: FixtureSource): TemplateSource => ({
  title: task.title,
  project_id: task.project_id,
  description: task.notes,
  labels: task.label_ids?.map((id) => ({ id })),
  priority: task.priority,
  due_date: task.due ? new Date(task.due).toISOString() : null,
  repeat_after: task.repeat_after,
  repeat_mode: task.repeat_mode,
  reminders: task.reminders,
  subtasks: task.subtasks?.map(toSource),
})

describe('taskTemplates (contract section 18)', () => {
  for (const vector of fixture.taskTemplates.capture) {
    it(`capture: ${vector.name}`, () => {
      expect(captureTemplate(toSource(vector.task), vector.today)).toEqual(vector.expect)
    })
  }

  for (const vector of fixture.taskTemplates.apply) {
    it(`apply: ${vector.name}`, () => {
      const { template, expect: want } = vector
      expect(templateProject(template, new Set(vector.projects), vector.fallback_project)).toBe(want.project_id)
      expect(templateDueDate(template.due, vector.today)).toBe(want.due ? new Date(want.due).toISOString() : null)
      expect((template.labels ?? []).filter((id) => vector.labels.includes(id))).toEqual(want.label_ids)
      expect(relativeReminders(template.reminders)).toEqual(want.reminders)
    })
  }

  for (const vector of fixture.taskTemplates.read) {
    it(`read: ${vector.name}`, () => {
      expect(readTemplate(vector.value) !== null).toBe(vector.isTemplate)
    })
  }

  it('an edit keeps unknown fields and drops what it cleared', () => {
    const written = encodeTemplate({ title: 'A', priority: 0, from_the_future: 1 })
    expect(written).toEqual({ title: 'A', from_the_future: 1 })
  })

  it('lists templates by when they were saved', () => {
    const values = {
      [templateKey('b')]: { title: 'Second', created_ms: 2 },
      [templateKey('a')]: { title: 'Third', created_ms: 3 },
      [templateKey('c')]: { title: 'First', created_ms: 1 },
      [templateKey('gone')]: null,
      other: { title: 'Not a template' },
    }
    expect(readTemplates(values).map((template) => template.title)).toEqual(['First', 'Second', 'Third'])
  })

  it('an edit keeps the subtasks it kept by title', () => {
    const kept = { title: 'Pack', subtasks: [{ title: 'Socks' }] }
    expect(withSubtaskTitles([{ title: 'Book' }, kept], ['Pack', 'New'])).toEqual([kept, { title: 'New' }])
  })

  it('refuses a template that is too large', () => {
    expect(isTemplateTooLarge({ title: 'A' })).toBe(false)
    expect(isTemplateTooLarge({ title: 'A', notes: 'x'.repeat(MAX_TEMPLATE_BYTES) })).toBe(true)
  })
})
