import { describe, expect, it } from 'vitest'
import { assignablePeople, assignChanges, assignMark, canAssignSelection } from '../bulk-assign'
import type { ProjectAccess } from '@/hooks/use-project-access'
import type { PersonRef, Task } from '../vikunja-types'

// Assign for a selection (docs/cross-app-semantics-v1.md section 9.2), the same rules as Android.

const me: PersonRef = { id: 1, username: 'me', name: 'Me' }
const maya: PersonRef = { id: 7, username: 'maya', name: 'Maya' }
const sam: PersonRef = { id: 8, username: 'sam', name: 'Sam' }

const access = new Map<number, ProjectAccess>([
  [10, { shared: true, members: [me, maya, sam], permission: 1 }],
  [11, { shared: true, members: [me, maya], permission: 2 }],
  [12, { shared: true, members: [me, maya], permission: 0 }],
  [13, { shared: false, members: [me], permission: 2 }],
])

const task = (id: number, project: number, assignees: PersonRef[] = []): Task => ({ id, title: `t${id}`, project_id: project, assignees } as Task)

describe('assign for a selection', () => {
  it('is offered only when every project is shared and writable', () => {
    expect(canAssignSelection([task(1, 10), task(2, 11)], access)).toBe(true)
    expect(canAssignSelection([task(1, 10), task(2, 12)], access)).toBe(false)
    expect(canAssignSelection([task(1, 10), task(2, 13)], access)).toBe(false)
    expect(canAssignSelection([task(1, 99)], access)).toBe(false)
    expect(canAssignSelection([], access)).toBe(false)
  })

  it('lists the members of every project, you first', () => {
    expect(assignablePeople([task(1, 10), task(2, 11)], access)).toEqual([me, maya])
    expect(assignablePeople([task(1, 10)], access)).toEqual([me, maya, sam])
  })

  it('ticks and what a pick changes', () => {
    const tasks = [task(1, 10, [maya]), task(2, 10)]
    expect(assignMark(maya, tasks)).toBe('some')
    expect(assignMark(sam, tasks)).toBe('none')
    expect(assignChanges(maya, tasks).map((c) => [c.task.id, c.assign])).toEqual([[2, true]])
    const all = [task(1, 10, [maya]), task(2, 10, [maya])]
    expect(assignMark(maya, all)).toBe('all')
    expect(assignChanges(maya, all).map((c) => [c.task.id, c.assign])).toEqual([[1, false], [2, false]])
  })
})
