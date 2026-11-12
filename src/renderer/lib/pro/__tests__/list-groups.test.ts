import { describe, expect, it } from 'vitest'
import { groupListTasks, type GroupableTask } from '../list-groups'

const helpers = {
  today: '2026-11-12',
  projectTitle: (id: number) => `P${id}`,
  personOf: (task: GroupableTask) => (task.id === 1 ? { id: 9, title: 'Maya' } : null),
}

const at = (day: string) => `${day}T23:59:59`

describe('groupListTasks', () => {
  it('returns null for none', () => {
    expect(groupListTasks([{ id: 1, project_id: 2 }], 'none', helpers)).toBeNull()
  })

  it('groups projects in order of first appearance', () => {
    const groups = groupListTasks([{ id: 1, project_id: 3 }, { id: 2, project_id: 2 }, { id: 3, project_id: 3 }], 'project', helpers)!
    expect(groups.map((group) => [group.title, group.tasks.map((task) => task.id)])).toEqual([['P3', [1, 3]], ['P2', [2]]])
  })

  it('puts a task under its first label by name and no label last', () => {
    const groups = groupListTasks([
      { id: 1, project_id: 1 },
      { id: 2, project_id: 1, labels: [{ id: 5, title: 'Zeta' }, { id: 6, title: 'Alpha' }] },
    ], 'label', helpers)!
    expect(groups.map((group) => group.title)).toEqual(['Alpha', 'No label'])
  })

  it('groups people with no person last', () => {
    const groups = groupListTasks([{ id: 2, project_id: 1 }, { id: 1, project_id: 1 }], 'person', helpers)!
    expect(groups.map((group) => group.title)).toEqual(['Maya', 'No person'])
  })

  it('buckets due dates in a fixed order', () => {
    const groups = groupListTasks([
      { id: 1, project_id: 1, due_date: at('2026-12-30') },
      { id: 2, project_id: 1, due_date: at('2026-11-10') },
      { id: 3, project_id: 1, due_date: '0001-01-01T00:00:00Z' },
      { id: 4, project_id: 1, due_date: at('2026-11-13') },
      { id: 5, project_id: 1, due_date: at('2026-11-12') },
      { id: 6, project_id: 1, due_date: at('2026-11-18') },
    ], 'due', helpers)!
    expect(groups.map((group) => group.title)).toEqual(['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Later', 'No due date'])
  })

  it('buckets start dates and flags', () => {
    const tasks = [
      { id: 1, project_id: 1, start_date: at('2026-11-20'), is_favorite: true },
      { id: 2, project_id: 1, start_date: at('2026-11-01') },
      { id: 3, project_id: 1 },
    ]
    expect(groupListTasks(tasks, 'start', helpers)!.map((group) => group.title)).toEqual(['Started', 'No start date', 'Starts later'])
    expect(groupListTasks(tasks, 'flagged', helpers)!.map((group) => group.tasks.length)).toEqual([1, 2])
  })
})
