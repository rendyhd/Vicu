import { describe, expect, it } from 'vitest'
import { duplicatePayload, duplicateTask, duplicationRoots, type DuplicateDeps } from '../duplicate-task'
import { NULL_DATE } from '../constants'
import type { CreateTaskPayload, Label, PersonRef, Task } from '../vikunja-types'

// Duplicate (docs/cross-app-semantics-v1.md section 15), the same rules as Android's TaskDuplicator.

const travel: Label = { id: 11, title: 'travel', hex_color: '' } as Label
const maya: PersonRef = { id: 7, username: 'maya', name: 'Maya' }

const task = (over: Partial<Task>): Task => ({
  id: 1,
  title: 'Pack for Lisbon',
  description: '<p>Passport</p>',
  done: true,
  done_at: '2026-10-30T10:00:00Z',
  due_date: '2026-11-02T22:59:59Z',
  start_date: NULL_DATE,
  end_date: NULL_DATE,
  priority: 3,
  project_id: 5,
  labels: [travel],
  reminders: [{ reminder: '2026-11-02T21:59:59Z', relative_period: -3600, relative_to: 'due_date' }],
  created: '',
  updated: '',
  created_by: { id: 1, username: 'me' },
  identifier: '',
  position: 4,
  bucket_id: 0,
  percent_done: 0,
  repeat_after: 86400,
  repeat_mode: 0,
  hex_color: '',
  assignees: [maya],
  ...over,
})

function rig(options: { shared?: boolean; offline?: boolean; children?: Record<number, Task[]> } = {}) {
  let next = 100
  const created: Array<{ projectId: number; payload: CreateTaskPayload; labels: Label[] }> = []
  const labelled: Array<[number, number]> = []
  const assigned: Array<[number, number]> = []
  const relations: Array<[number, number]> = []
  const deps: DuplicateDeps = {
    createTask: async (projectId, payload, labels) => {
      created.push({ projectId, payload, labels })
      return task({ id: options.offline ? -(next++) : next++, title: payload.title, project_id: projectId })
    },
    addLabel: async (copy, label) => { labelled.push([copy.id, label.id]) },
    assign: async (copy, person) => { assigned.push([copy.id, person.id]) },
    createSubtaskRelation: async (parent, child) => { relations.push([parent, child]) },
    subtasksOf: async (original) => options.children?.[original.id] ?? [],
    isShared: () => options.shared === true,
  }
  return { deps, created, labelled, assigned, relations }
}

describe('duplicate a task', () => {
  it('copies the fields as an open task without its position', () => {
    const payload = duplicatePayload(task({}))
    expect(payload).toEqual({
      title: 'Pack for Lisbon',
      description: '<p>Passport</p>',
      due_date: '2026-11-02T22:59:59Z',
      priority: 3,
      repeat_after: 86400,
      reminders: [{ reminder: '2026-11-02T21:59:59Z', relative_period: -3600, relative_to: 'due_date' }],
    })
    expect(payload).not.toHaveProperty('done')
    expect(payload).not.toHaveProperty('start_date')
  })

  it('adds the labels, and the assignees only on a shared project', async () => {
    const privately = rig()
    await duplicateTask(task({}), privately.deps)
    expect(privately.labelled).toEqual([[100, 11]])
    expect(privately.assigned).toEqual([])

    const shared = rig({ shared: true })
    await duplicateTask(task({}), shared.deps)
    expect(shared.assigned).toEqual([[100, 7]])
  })

  it('copies subtasks, nested ones included, and links them', async () => {
    const r = rig({ children: { 1: [task({ id: 2, title: 'Chargers', labels: [] })], 2: [task({ id: 3, title: 'Adapter', labels: [] })] } })
    const { problems } = await duplicateTask(task({}), r.deps)
    expect(r.created.map((c) => c.payload.title)).toEqual(['Pack for Lisbon', 'Chargers', 'Adapter'])
    expect(r.relations).toEqual([[101, 102], [100, 101]])
    expect(problems).toEqual([])
  })

  it('ends a relation cycle', async () => {
    const r = rig({ children: { 1: [task({ id: 2, title: 'Loop', labels: [] })], 2: [task({ id: 1, title: 'Back' })] } })
    await duplicateTask(task({}), r.deps)
    expect(r.created).toHaveLength(2)
  })

  it('leaves the subtasks of a copy saved offline and says so; the queued create carries the labels', async () => {
    const r = rig({ offline: true, children: { 1: [task({ id: 2, title: 'Chargers' })] } })
    const { problems } = await duplicateTask(task({}), r.deps)
    expect(r.created).toHaveLength(1)
    expect(r.created[0].labels).toEqual([travel])
    expect(r.labelled).toEqual([])
    expect(problems).toEqual(['“Pack for Lisbon” was saved offline, so its subtasks were not copied.'])
  })

  it('copies a selected subtask only with its selected parent', () => {
    const child = task({ id: 2 })
    const parent = task({ id: 1, related_tasks: { subtask: [child] } })
    const other = task({ id: 3 })
    const roots = duplicationRoots([child, parent, other], (t) => (t.related_tasks?.subtask ?? []).map((c) => c.id))
    expect(roots.map((t) => t.id)).toEqual([1, 3])
  })
})
