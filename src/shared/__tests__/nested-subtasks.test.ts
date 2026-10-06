import { describe, expect, it } from 'vitest'
import { filterCustomList } from '../custom-list-filter'
import { withoutNestedSubtasks } from '../nested-subtasks'

interface TestTask {
  id: number
  project_id: number
  done: boolean
  due_date?: string
  labels?: Array<{ id: number }>
  related_tasks?: { parenttask?: Array<{ id: number; done?: boolean }>; subtask?: Array<{ id: number }> }
}

const parent = (id: number, overrides: Partial<TestTask> = {}): TestTask => ({
  id, project_id: 10, done: false, related_tasks: { subtask: [{ id: id + 1 }] }, ...overrides,
})
const child = (id: number, parentId: number, parentDone = false, overrides: Partial<TestTask> = {}): TestTask => ({
  id, project_id: 10, done: false, related_tasks: { parenttask: [{ id: parentId, done: parentDone }] }, ...overrides,
})

describe('withoutNestedSubtasks', () => {
  it('hides a child whose parent is in the list', () => {
    const tasks = [parent(1), child(2, 1)]
    expect(withoutNestedSubtasks(tasks).map((t) => t.id)).toEqual([1])
  })

  it('hides a child of a completed parent by default, as every fetch does', () => {
    expect(withoutNestedSubtasks([child(2, 1, true)])).toEqual([])
  })

  it('can keep a child of a completed parent that is not in the list', () => {
    const tasks = [child(2, 1, true)]
    expect(withoutNestedSubtasks(tasks, { hideChildrenOfCompletedParents: false })).toEqual(tasks)
  })

  it('still hides a child whose completed parent is in the list when that rule is off', () => {
    const tasks = [parent(1, { done: true }), child(2, 1, true)]
    expect(withoutNestedSubtasks(tasks, { hideChildrenOfCompletedParents: false }).map((t) => t.id)).toEqual([1])
  })
})

describe('filtering before hiding nested subtasks (X-16)', () => {
  // Parent 1 has no label; its subtask 2 has label 7. Parent 3 and its subtask 4 both have it.
  const tasks: TestTask[] = [
    parent(1),
    child(2, 1, false, { labels: [{ id: 7 }] }),
    parent(3, { labels: [{ id: 7 }] }),
    child(4, 3, false, { labels: [{ id: 7 }] }),
  ]
  const tagged = (list: TestTask[]) => filterCustomList(list, { label_ids: [7], include_done: true }, '2026-10-06')

  it('the old order (hide nested first) loses a matching subtask whose parent does not match', () => {
    const oldOrder = tagged(withoutNestedSubtasks(tasks))
    expect(oldOrder.map((t) => t.id)).toEqual([3])
  })

  it('shows a matching subtask whose parent does not match, and nests one whose parent matches', () => {
    const newOrder = withoutNestedSubtasks(tagged(tasks), { hideChildrenOfCompletedParents: false })
    expect(newOrder.map((t) => t.id)).toEqual([2, 3])
  })

  it('shows an open matching subtask whose parent is completed and filtered out', () => {
    const list: TestTask[] = [child(2, 1, true, { labels: [{ id: 7 }] })]
    const result = withoutNestedSubtasks(filterCustomList(list, { label_ids: [7] }, '2026-10-06'), { hideChildrenOfCompletedParents: false })
    expect(result.map((t) => t.id)).toEqual([2])
  })
})
