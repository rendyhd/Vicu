/**
 * Assign for a selection (cross-app semantics 9.2): when it is offered, who is listed, how each
 * person is ticked and what picking them changes. Pure, the same rules as Android's BulkAssign; the
 * popover sends each change through the single task's assign.
 */
import type { ProjectAccess } from '@/hooks/use-project-access'
import type { PersonRef, Task } from './vikunja-types'

export type AssignMark = 'none' | 'some' | 'all'

/** Every selected task is in a shared project where you may write. */
export function canAssignSelection(tasks: readonly Task[], access: ReadonlyMap<number, ProjectAccess>): boolean {
  return tasks.length > 0 && tasks.every((task) => {
    const a = access.get(task.project_id)
    return !!a && a.shared && a.permission >= 1
  })
}

/** The members of every project of `tasks`, in the first project's order (you first, 9.3). */
export function assignablePeople(tasks: readonly Task[], access: ReadonlyMap<number, ProjectAccess>): PersonRef[] {
  const lists = [...new Set(tasks.map((t) => t.project_id))].map((id) => access.get(id)?.members ?? [])
  if (lists.length === 0) return []
  const common = new Set(lists[0].map((p) => p.id))
  for (const members of lists.slice(1)) {
    const ids = new Set(members.map((p) => p.id))
    for (const id of [...common]) if (!ids.has(id)) common.delete(id)
  }
  return lists[0].filter((p) => common.has(p.id))
}

export function assignMark(person: PersonRef, tasks: readonly Task[]): AssignMark {
  const assigned = tasks.filter((task) => (task.assignees ?? []).some((a) => a.id === person.id)).length
  if (assigned === 0) return 'none'
  return assigned === tasks.length ? 'all' : 'some'
}

/** Picking `person`: assigned to all, removed from all; otherwise added where missing. */
export function assignChanges(person: PersonRef, tasks: readonly Task[]): Array<{ task: Task; assign: boolean }> {
  if (assignMark(person, tasks) === 'all') return tasks.map((task) => ({ task, assign: false }))
  return tasks.filter((task) => !(task.assignees ?? []).some((a) => a.id === person.id)).map((task) => ({ task, assign: true }))
}
