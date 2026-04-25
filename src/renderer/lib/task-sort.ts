import type { Task } from './vikunja-types'
import { NULL_DATE } from './constants'

function hasDueDate(t: Task): boolean {
  return !!t.due_date && t.due_date !== NULL_DATE
}

export function compareProjectTasks(a: Task, b: Task): number {
  const aDated = hasDueDate(a)
  const bDated = hasDueDate(b)
  if (aDated !== bDated) return aDated ? -1 : 1
  if (aDated && bDated) {
    const diff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    if (diff !== 0) return diff
  }
  return (a.position ?? 0) - (b.position ?? 0)
}

export function sortProjectTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareProjectTasks)
}
