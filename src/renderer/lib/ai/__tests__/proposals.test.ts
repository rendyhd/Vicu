import { describe, expect, it } from 'vitest'
import { applyProposal, buildProposal, updateChanges, withEditedDue, type ApplyDeps } from '../proposals'
import { readSaid } from '../said-parser'
import { task, workspace } from './helpers'
import { ToolError } from '../ask-tools'

// docs/ai-assistant-v1.md section 5.4: skip reasons, only changed fields, notes appended, Undo.
const ws = workspace()
const tasks = new Map([
  [1, task(1, 'Call the plumber', { project_id: 12, due_date: new Date(2026, 9, 7, 23, 59, 59).toISOString(), labels: [{ id: 4, title: 'phone' } as never], description: '<p>Kitchen tap</p>' })],
  [2, task(2, 'Archived thing', { project_id: 30 })],
  [3, task(3, 'Read only', { project_id: 40 })],
  [4, task(4, 'Hidden carrier', { description: '<!-- vicu-routine:v1:abc -->' })],
  [5, task(5, 'Done already', { done: true })],
])
const reference = '2026-10-06T10:00:00'
const deps = {
  ws,
  fetchTask: async (id: number) => tasks.get(id) ?? null,
  reference,
  readSaid: (said: string) => readSaid(said, reference, 'en-US'),
  defaultProjectId: 1,
}

const change = (taskId: number, extra: Record<string, unknown> = {}) => ({
  task_id: taskId, title: null, append_notes: null, when: null, clear_due: false, project_id: null, labels_add: [], labels_remove: [], priority: null, ...extra,
})

describe('proposals', () => {
  it('lists tasks that cannot change as skipped: not_found, read_only, invalid', async () => {
    const proposal = await buildProposal('propose_update_tasks', {
      changes: [
        change(99, { priority: 3 }),
        change(4, { priority: 3 }),
        change(2, { priority: 3 }),
        change(3, { priority: 3 }),
        change(1, { when: { said: 'friday', date: null, time: null }, clear_due: true }),
        change(1, { title: 'Call the plumber' }),
        change(1, { priority: 9 }),
        change(1, { priority: 2 }),
      ],
    }, deps)
    expect(proposal.skipped).toEqual([
      { task_id: 99, reason: 'not_found' },
      { task_id: 4, reason: 'not_found' },
      { task_id: 2, reason: 'read_only' },
      { task_id: 3, reason: 'read_only' },
      { task_id: 1, reason: 'invalid' },
      { task_id: 1, reason: 'invalid' },
      { task_id: 1, reason: 'invalid' },
    ])
    expect(proposal.tool === 'propose_update_tasks' && proposal.updates.map((u) => u.priority)).toEqual([2])
  })

  it('reads a new due date by the dictation rules and sends only the changed fields', async () => {
    const proposal = await buildProposal('propose_update_tasks', {
      changes: [change(1, { when: { said: 'friday', date: '2026-10-30', time: null }, append_notes: 'Ask about the boiler', labels_add: ['#errands', 'phone', 'new one'], labels_remove: ['PHONE'] })],
    }, deps)
    if (proposal.tool !== 'propose_update_tasks') throw new Error('wrong kind')
    const [item] = proposal.updates
    expect(item.due).toBe('2026-10-09T23:59:59')
    expect(item.dueGuessed).toBe(false)
    expect(item.labelsAdd).toEqual([{ id: 3, title: 'errands' }, { id: null, title: 'new one' }])
    expect(item.labelsRemove.map((l) => l.id)).toEqual([4])
    const changes = updateChanges(item)
    expect(Object.keys(changes).sort()).toEqual(['description', 'due_date'])
    expect(changes.description).toBe('<p>Kitchen tap</p>\n<p>Ask about the boiler</p>')
  })

  it('skips a completion that changes nothing', async () => {
    const proposal = await buildProposal('propose_complete_tasks', { task_ids: [5, 1, 1, 99], done: true }, deps)
    expect(proposal.skipped).toEqual([{ task_id: 5, reason: 'invalid' }, { task_id: 99, reason: 'not_found' }])
    expect(proposal.tool === 'propose_complete_tasks' && proposal.tasks.map((t) => t.id)).toEqual([1])
  })

  it('checks created tasks by the dictation checks', async () => {
    const proposal = await buildProposal('propose_create_tasks', {
      tasks: [{ ref: 'd1', title: 'Buy stamps', notes: '', when: { said: 'tomorrow', date: null, time: null }, project_id: 30, labels: [], priority: null, repeat: null, reminder: null, place: null, subtasks: [], unsure: [] }],
    }, deps)
    if (proposal.tool !== 'propose_create_tasks') throw new Error('wrong kind')
    // An archived project is not one the user can write to: the default project, guessed.
    expect(proposal.drafts[0]).toMatchObject({ due: '2026-10-07T23:59:59', project_id: 1, guessed: ['project'] })
  })

  it('refuses more than 50 tasks', async () => {
    await expect(buildProposal('propose_complete_tasks', { task_ids: Array.from({ length: 51 }, (_, i) => i + 100), done: true }, deps))
      .rejects.toBeInstanceOf(ToolError)
  })

  it('applies through the given paths, reports the result, and Undo puts back the previous values', async () => {
    const calls: string[] = []
    const applyDeps: ApplyDeps = {
      addDrafts: async () => ({ created: [], tasks: [] }),
      deleteTask: async (t) => { calls.push(`delete ${t.id}`) },
      updateTask: async (t, c) => { calls.push(`update ${t.id} ${JSON.stringify(c)}`) },
      createLabel: async (title) => { calls.push(`create-label ${title}`); return { id: 77, title } as never },
      addLabel: async (t, l) => { calls.push(`add-label ${t.id} ${l.id}`) },
      removeLabel: async (t, id) => { calls.push(`remove-label ${t.id} ${id}`) },
      complete: async (t) => { calls.push(`complete ${t.id}`) },
      reopen: async (t) => { calls.push(`reopen ${t.id}`) },
    }
    const proposal = await buildProposal('propose_update_tasks', { changes: [change(1, { priority: 4, labels_add: ['fresh'] }), change(99, { priority: 1 })] }, deps)
    const applied = await applyProposal(proposal, applyDeps)
    expect(applied.result).toEqual({ status: 'partly_applied', applied: [1], skipped: [{ task_id: 99, reason: 'not_found' }] })
    expect(calls).toEqual(['update 1 {"priority":4}', 'create-label fresh', 'add-label 1 77'])
    calls.length = 0
    await applied.undo()
    expect(calls).toEqual(['remove-label 1 77', 'update 1 {"priority":0}'])

    const done = await applyProposal(await buildProposal('propose_complete_tasks', { task_ids: [1], done: true }, deps), applyDeps)
    expect(done.result).toEqual({ status: 'applied', applied: [1], skipped: [] })
  })

  it('writes the date chosen on the card and tells the model', async () => {
    const calls: Array<Record<string, unknown>> = []
    const applyDeps = {
      updateTask: async (_task: unknown, changes: Record<string, unknown>) => { calls.push(changes) },
    } as unknown as ApplyDeps
    const built = await buildProposal('propose_update_tasks', { changes: [change(1, { when: { said: 'tomorrow', date: '2026-10-07', time: null, confidence: 'high' }, priority: 3 })] }, deps)
    const edited = withEditedDue(built, 1, '2026-10-20T23:59:59')
    const applied = await applyProposal(edited, applyDeps)
    expect(calls[0].due_date).toBe(new Date(2026, 9, 20, 23, 59, 59).toISOString())
    expect(applied.result.edited).toEqual([{ task_id: 1, due: '2026-10-20T23:59:59' }])
  })

  it('leaves edited out when no date was changed', async () => {
    const applyDeps = { updateTask: async () => {} } as unknown as ApplyDeps
    const built = await buildProposal('propose_update_tasks', { changes: [change(1, { priority: 3 })] }, deps)
    expect(await applyProposal(built, applyDeps).then((a) => 'edited' in a.result)).toBe(false)
  })

  it('reports a removed date as null, and a date changed on a new task by its ref', async () => {
    const applyDeps = {
      updateTask: async () => {},
      addDrafts: async () => ({ created: [tasks.get(1)!], tasks: [tasks.get(1)!] }),
    } as unknown as ApplyDeps
    const update = await buildProposal('propose_update_tasks', { changes: [change(1, { clear_due: true })] }, deps)
    expect((await applyProposal(withEditedDue(update, 1, null), applyDeps)).result.edited).toEqual([{ task_id: 1, due: null }])

    const create = await buildProposal('propose_create_tasks', { tasks: [{ ref: 't1', title: 'New', notes: '', when: null, project_id: 1, labels: [], priority: null, repeat: null, reminder: null, place: null, subtasks: [], unsure: [] }] }, deps)
    expect(create.tool === 'propose_create_tasks' && create.drafts[0].ref).toBe('t1')
    const applied = await applyProposal(withEditedDue(create, 't1', '2026-10-20T14:00:00'), applyDeps)
    expect(applied.result.edited).toEqual([{ ref: 't1', due: '2026-10-20T14:00:00' }])
  })
})
