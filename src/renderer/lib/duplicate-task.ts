/**
 * Duplicate (docs/cross-app-semantics-v1.md section 15): a new open task in the same project with
 * the original's fields, labels, assignees (on a shared project) and subtasks, nested ones
 * included, through the create quick add uses: queued with its labels when the server cannot be
 * reached. A subtask relation needs both tasks on the server, so a copy that only exists offline
 * goes without its subtasks and says so. The writes are injected so this stays testable.
 */
import { isNullDate } from './date-utils'
import { isTempTaskId } from './pending-cache'
import type { CreateTaskPayload, Label, PersonRef, Task } from './vikunja-types'

export interface DuplicateDeps {
  createTask(projectId: number, payload: CreateTaskPayload, labels: Label[]): Promise<Task>
  addLabel(task: Task, label: Label): Promise<void>
  assign(task: Task, person: PersonRef): Promise<void>
  createSubtaskRelation(parentId: number, childId: number): Promise<void>
  /** The subtasks of a task, in order, as full tasks. */
  subtasksOf(task: Task): Promise<Task[]>
  isShared(projectId: number): boolean
}

export interface DuplicateResult {
  copy: Task
  problems: string[]
}

/** What a copy takes from `task` (section 15): always open, no comments, attachments or position. */
export function duplicatePayload(task: Task): CreateTaskPayload {
  const payload: CreateTaskPayload = { title: task.title }
  if (task.description) payload.description = task.description
  if (!isNullDate(task.due_date)) payload.due_date = task.due_date
  if (!isNullDate(task.start_date)) payload.start_date = task.start_date
  if (task.priority) payload.priority = task.priority
  if (task.repeat_after) payload.repeat_after = task.repeat_after
  if (task.repeat_mode) payload.repeat_mode = task.repeat_mode
  if (task.reminders?.length) payload.reminders = task.reminders.map((r) => ({ ...r }))
  return payload
}

export async function duplicateTask(task: Task, deps: DuplicateDeps): Promise<DuplicateResult> {
  const problems: string[] = []
  const shared = deps.isShared(task.project_id)
  const visited = new Set<number>([task.id])

  const copyOf = async (original: Task): Promise<Task> => {
    const labels = original.labels ?? []
    const copy = await deps.createTask(original.project_id, duplicatePayload(original), labels)
    // A queued create carries its labels; a created one gets them now.
    if (!isTempTaskId(copy.id)) {
      for (const label of labels) {
        try {
          await deps.addLabel(copy, label)
        } catch {
          problems.push(`A label could not be added to “${copy.title}”.`)
        }
      }
    }
    if (shared) {
      for (const person of original.assignees ?? []) {
        try {
          await deps.assign(copy, person)
        } catch {
          problems.push(`${person.name || person.username} could not be assigned to “${copy.title}”.`)
        }
      }
    }
    const children = (await deps.subtasksOf(original)).filter((child) => !visited.has(child.id))
    if (children.length === 0) return copy
    if (isTempTaskId(copy.id)) {
      problems.push(`“${copy.title}” was saved offline, so its subtasks were not copied.`)
      return copy
    }
    for (const child of children) {
      visited.add(child.id)
      try {
        const childCopy = await copyOf(child)
        if (isTempTaskId(childCopy.id)) {
          problems.push(`A subtask of “${copy.title}” was saved offline and could not be linked.`)
        } else {
          await deps.createSubtaskRelation(copy.id, childCopy.id)
        }
      } catch {
        problems.push(`A subtask of “${copy.title}” could not be copied.`)
      }
    }
    return copy
  }

  return { copy: await copyOf(task), problems }
}

/**
 * The tasks a selection duplicates: each once, and a selected subtask of another selected task
 * only with that task (section 15). `descendantIds` gives every task below one.
 */
export function duplicationRoots(selected: readonly Task[], descendantIds: (task: Task) => number[]): Task[] {
  const inside = new Set(selected.flatMap(descendantIds))
  return selected.filter((task) => !inside.has(task.id))
}
