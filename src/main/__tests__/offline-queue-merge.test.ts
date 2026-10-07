import { describe, expect, it } from 'vitest'
import {
  cancelPatchKeys,
  mergeAddLabel,
  mergeDelete,
  mergeRemoveLabel,
  mergeUpdate,
  remapTempId,
} from '../offline/queue-merge'
import type {
  AddLabelAction,
  CreateAction,
  DeleteAction,
  QueuedAction,
  RemoveLabelAction,
  UpdateAction,
  UploadAttachmentAction,
} from '../offline/types'

const T0 = '2026-10-06T10:00:00.000Z'

let counter = 0
const nextId = () => `a${++counter}`

const create = (tempId: number, fields: Record<string, unknown> = { title: 'New task' }, extra: Partial<CreateAction> = {}): CreateAction => ({
  id: nextId(), type: 'create', createdAt: T0, attempts: 0, tempId, projectId: 7, fields, ...extra,
})
const update = (taskId: number, patch: Record<string, unknown>, extra: Partial<UpdateAction> = {}): UpdateAction => ({
  id: nextId(), type: 'update', createdAt: T0, attempts: 0, taskId, patch, ...extra,
})
const del = (taskId: number): DeleteAction => ({ id: nextId(), type: 'delete', createdAt: T0, attempts: 0, taskId })
const addLabel = (taskId: number, labelId?: number, labelTitle?: string): AddLabelAction => ({
  id: nextId(), type: 'add-label', createdAt: T0, attempts: 0, taskId, labelId, labelTitle,
})
const removeLabel = (taskId: number, labelId: number): RemoveLabelAction => ({
  id: nextId(), type: 'remove-label', createdAt: T0, attempts: 0, taskId, labelId,
})
const upload = (taskId: number, file = 'f1'): UploadAttachmentAction => ({
  id: nextId(), type: 'upload-attachment', createdAt: T0, attempts: 0, taskId, file, name: 'image.png', mime: 'image/png',
})

describe('mergeUpdate', () => {
  describe('no pending create for the task (Android: ReplaceForEntity)', () => {
    it('appends the update to an empty queue', () => {
      const u = update(5, { done: true })
      const out = mergeUpdate([], u, null)
      expect(out.actions).toEqual([u])
      expect(out.foldedInto).toBeNull()
    })

    it('appends it behind unrelated actions', () => {
      const other = update(9, { title: 'x' })
      const u = update(5, { done: true })
      expect(mergeUpdate([other], u, null).actions).toEqual([other, u])
    })

    it('merges into an existing update of the same task, newest values winning', () => {
      // Android: "merge patch payloads keep prior fields and newest explicit values"
      const first = update(5, { description: 'offline edit', done: true, priority: 3 })
      const out = mergeUpdate([first], update(5, { done: false, priority: 0, due_date: null }), null)

      expect(out.actions).toHaveLength(1)
      expect(out.actions[0]).toMatchObject({
        id: first.id,
        type: 'update',
        taskId: 5,
        patch: { description: 'offline edit', done: false, priority: 0, due_date: null },
      })
      expect(out.foldedInto).toBe(first.id)
    })

    it('keeps the position of the update it merged into', () => {
      const a = update(5, { title: 'a' })
      const b = update(6, { title: 'b' })
      const out = mergeUpdate([a, b], update(5, { priority: 2 }), null)
      expect(out.actions.map((x) => x.id)).toEqual([a.id, b.id])
    })

    it('ignores an empty patch', () => {
      const first = update(5, { done: true })
      const out = mergeUpdate([first], update(5, {}), null)
      expect(out.actions).toEqual([first])
      expect(out.noop).toBe(true)
    })

    it('does nothing for a task that already has a delete queued', () => {
      const d = del(5)
      const out = mergeUpdate([d], update(5, { title: 'late' }), null)
      expect(out.actions).toEqual([d])
      expect(out.noop).toBe(true)
    })
  })

  describe('pending create (Android: UpdateCreatePayload)', () => {
    it('folds an edit into the create: update + create = create with merged fields', () => {
      const c = create(-1, { title: 'Draft', priority: 1 })
      const out = mergeUpdate([c], update(-1, { title: 'Final', due_date: '2026-10-07T23:59:59Z' }), null)

      expect(out.actions).toHaveLength(1)
      expect(out.actions[0]).toMatchObject({
        id: c.id,
        type: 'create',
        tempId: -1,
        fields: { title: 'Final', priority: 1, due_date: '2026-10-07T23:59:59Z' },
      })
      expect(out.foldedInto).toBe(c.id)
    })

    it('folds a completion into the create as done', () => {
      const c = create(-1)
      const out = mergeUpdate([c], update(-1, { done: true }), null)
      expect(out.actions).toHaveLength(1)
      expect(out.actions[0]).toMatchObject({ type: 'create', done: true })
      // `done` is not a create field; it becomes a follow-up update once the task exists.
      expect((out.actions[0] as CreateAction).fields).not.toHaveProperty('done')
    })

    it('folds an uncomplete into the create', () => {
      const c = create(-1, { title: 'x' }, { done: true })
      const out = mergeUpdate([c], update(-1, { done: false }), null)
      expect((out.actions[0] as CreateAction).done).toBeFalsy()
    })

    it('clears a due date by removing it from the create instead of sending null', () => {
      const c = create(-1, { title: 'x', due_date: '2026-10-07T23:59:59Z' })
      const out = mergeUpdate([c], update(-1, { due_date: null }), null)
      expect((out.actions[0] as CreateAction).fields).toEqual({ title: 'x' })
    })

    it('moves the create to another project when the patch changes project_id', () => {
      const c = create(-1)
      const out = mergeUpdate([c], update(-1, { project_id: 12 }), null)
      expect((out.actions[0] as CreateAction).projectId).toBe(12)
      expect((out.actions[0] as CreateAction).fields).not.toHaveProperty('project_id')
    })

    it('does not fold into a create that is already being sent; the change follows it', () => {
      const c = create(-1)
      const u = update(-1, { title: 'edited while sending' })
      const out = mergeUpdate([c], u, c.id)
      expect(out.actions).toEqual([c, u])
      expect(out.foldedInto).toBeNull()
    })
  })

  describe('an update that is already being sent', () => {
    it('is never merged into: a new update is appended behind it', () => {
      const sending = update(5, { done: true })
      const next = update(5, { done: false })
      const out = mergeUpdate([sending], next, sending.id)
      expect(out.actions).toEqual([sending, next])
      expect(out.foldedInto).toBeNull()
    })

    it('merges into the queued update behind the one being sent', () => {
      const sending = update(5, { done: true })
      const queued = update(5, { title: 'a' })
      const out = mergeUpdate([sending, queued], update(5, { priority: 4 }), sending.id)
      expect(out.actions).toHaveLength(2)
      expect(out.actions[1]).toMatchObject({ id: queued.id, patch: { title: 'a', priority: 4 } })
    })
  })
})

describe('mergeDelete', () => {
  it('appends a delete for a task with nothing queued', () => {
    const d = del(5)
    expect(mergeDelete([], d, null).actions).toEqual([d])
  })

  it('removes the create and its dependents when a pending task is deleted: delete + create = both removed', () => {
    const c = create(-1)
    const u = update(-1, { priority: 2 })
    const l = addLabel(-1, 3)
    const img = upload(-1, 'file-1')
    const unrelated = update(9, { done: true })

    const out = mergeDelete([c, u, l, img, unrelated], del(-1), null)

    expect(out.actions).toEqual([unrelated])
    expect(out.removed.map((a) => a.id).sort()).toEqual([c.id, u.id, l.id, img.id].sort())
    expect(out.noop).toBe(true) // the server never needs to know
  })

  it('drops queued updates and label changes for a synced task and queues one delete', () => {
    const u = update(5, { title: 'x' })
    const l = addLabel(5, 3)
    const d = del(5)
    const out = mergeDelete([u, l], d, null)
    expect(out.actions).toEqual([d])
    expect(out.removed.map((a) => a.id)).toEqual([u.id, l.id])
  })

  it('keeps the update that is already being sent and deletes behind it', () => {
    const sending = update(5, { done: true })
    const d = del(5)
    const out = mergeDelete([sending], d, sending.id)
    expect(out.actions).toEqual([sending, d])
  })

  it('does not queue a second delete', () => {
    const d1 = del(5)
    const out = mergeDelete([d1], del(5), null)
    expect(out.actions).toEqual([d1])
    expect(out.noop).toBe(true)
  })

  it('deletes behind a create that is being sent, because the task will exist when it finishes', () => {
    const c = create(-1)
    const d = del(-1)
    const out = mergeDelete([c], d, c.id)
    expect(out.actions).toEqual([c, d])
  })
})

describe('label actions', () => {
  it('queues an add', () => {
    const a = addLabel(5, 3)
    expect(mergeAddLabel([], a, null).actions).toEqual([a])
  })

  it('ignores adding the same label twice, by id or by title', () => {
    const byId = addLabel(5, 3)
    expect(mergeAddLabel([byId], addLabel(5, 3), null).actions).toEqual([byId])
    const byTitle = addLabel(5, undefined, 'Home')
    expect(mergeAddLabel([byTitle], addLabel(5, undefined, 'home'), null).actions).toEqual([byTitle])
  })

  it('an add followed by a remove of the same label cancels out', () => {
    const add = addLabel(5, 3)
    const out = mergeRemoveLabel([add], removeLabel(5, 3), null)
    expect(out.actions).toEqual([])
    expect(out.noop).toBe(true)
  })

  it('a remove followed by an add of the same label cancels out', () => {
    const rem = removeLabel(5, 3)
    const out = mergeAddLabel([rem], addLabel(5, 3), null)
    expect(out.actions).toEqual([])
    expect(out.noop).toBe(true)
  })

  it('does not cancel against an action that is already being sent', () => {
    const add = addLabel(5, 3)
    const rem = removeLabel(5, 3)
    const out = mergeRemoveLabel([add], rem, add.id)
    expect(out.actions).toEqual([add, rem])
  })

  it('labels on different tasks do not interact', () => {
    const add = addLabel(5, 3)
    const out = mergeRemoveLabel([add], removeLabel(6, 3), null)
    expect(out.actions).toHaveLength(2)
  })
})

describe('cancelPatchKeys (undo of a queued change)', () => {
  it('removes the key from a queued update and drops the update when it becomes empty', () => {
    const u = update(5, { done: true })
    const out = cancelPatchKeys([u], 5, ['done'], null)
    expect(out.cancelled).toBe(true)
    expect(out.actions).toEqual([])
    expect(out.removed.map((a) => a.id)).toEqual([u.id])
  })

  it('keeps the other fields of the update', () => {
    const u = update(5, { done: true, title: 'x' })
    const out = cancelPatchKeys([u], 5, ['done'], null)
    expect(out.cancelled).toBe(true)
    expect(out.actions).toEqual([{ ...u, patch: { title: 'x' } }])
  })

  it('un-completes a pending create', () => {
    const c = create(-1, { title: 'x' }, { done: true })
    const out = cancelPatchKeys([c], -1, ['done'], null)
    expect(out.cancelled).toBe(true)
    expect((out.actions[0] as CreateAction).done).toBeFalsy()
  })

  it('reports false when nothing was queued for that key, so the caller sends a real update', () => {
    const u = update(5, { title: 'x' })
    const out = cancelPatchKeys([u], 5, ['done'], null)
    expect(out.cancelled).toBe(false)
    expect(out.actions).toEqual([u])
  })

  it('cannot cancel a change that is already being sent: undo during replay (D-SYNC-4)', () => {
    const sending = update(5, { done: true })
    const out = cancelPatchKeys([sending], 5, ['done'], sending.id)
    expect(out.cancelled).toBe(false)
    expect(out.actions).toEqual([sending])
  })

  it('leaves other tasks alone', () => {
    const other = update(9, { done: true })
    const out = cancelPatchKeys([other], 5, ['done'], null)
    expect(out.actions).toEqual([other])
  })
})

describe('remapTempId', () => {
  it('rewrites the temp id in every action that follows the create, whatever its type', () => {
    const actions: QueuedAction[] = [
      update(-1, { priority: 2 }),
      addLabel(-1, 3),
      removeLabel(-1, 4),
      upload(-1),
      del(-1),
      update(-2, { title: 'other temp task' }),
      update(8, { title: 'real task' }),
    ]
    const out = remapTempId(actions, -1, 101)
    expect(out.map((a) => (a as { taskId: number }).taskId)).toEqual([101, 101, 101, 101, 101, -2, 8])
  })

  it('does not touch the action objects it does not change', () => {
    const keep = update(8, { title: 'real task' })
    const out = remapTempId([update(-1, { done: true }), keep], -1, 101)
    expect(out[1]).toBe(keep)
  })
})

describe('chained temp-id actions', () => {
  it('create, edit, label and image all resolve against one create', () => {
    // The user creates a task offline and keeps working on it: nothing is lost and one create stays.
    let actions: QueuedAction[] = [create(-1, { title: 'Pack', priority: 1 })]
    actions = mergeUpdate(actions, update(-1, { title: 'Pack bags' }), null).actions
    actions = mergeAddLabel(actions, addLabel(-1, undefined, 'Travel'), null).actions
    actions = [...actions, upload(-1)]
    actions = mergeUpdate(actions, update(-1, { done: true }), null).actions

    expect(actions.map((a) => a.type)).toEqual(['create', 'add-label', 'upload-attachment'])
    expect(actions[0]).toMatchObject({ fields: { title: 'Pack bags', priority: 1 }, done: true })

    // The create replays and gets a real id: the follow-ups now point at it.
    const remapped = remapTempId(actions.slice(1), -1, 55)
    expect(remapped.map((a) => (a as { taskId: number }).taskId)).toEqual([55, 55])
  })
})
