import type { Task } from '@/lib/vikunja-types'

/** Returns every descendant once, with parents before their children. */
export function taskDescendants(task: Task): Task[] {
  const result: Task[] = []
  const visited = new Set<number>([task.id])

  const visit = (parent: Task) => {
    for (const child of parent.related_tasks?.subtask ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      result.push(child)
      visit(child)
    }
  }

  visit(task)
  return result
}

export function unfinishedDescendants(task: Task): Task[] {
  return taskDescendants(task).filter((child) => !child.done)
}

export function subtaskProgress(task: Task): { completed: number; total: number } {
  const descendants = taskDescendants(task)
  return {
    completed: descendants.filter((child) => child.done).length,
    total: descendants.length,
  }
}

/** Applies done-state changes to a root and any embedded relation copies in the cache. */
export function mapTaskDoneByIds(task: Task, doneById: ReadonlyMap<number, boolean>): Task {
  const nextDone = doneById.get(task.id)
  const relatedTasks = task.related_tasks
    ? Object.fromEntries(
        Object.entries(task.related_tasks).map(([kind, related]) => [
          kind,
          related.map((item) => mapTaskDoneByIds(item, doneById)),
        ]),
      )
    : task.related_tasks

  return {
    ...task,
    ...(nextDone === undefined
      ? {}
      : { done: nextDone, done_at: nextDone ? new Date().toISOString() : '0001-01-01T00:00:00Z' }),
    related_tasks: relatedTasks,
  }
}

export function removeTaskIdsFromTree(task: Task, ids: ReadonlySet<number>): Task | null {
  if (ids.has(task.id)) return null
  if (!task.related_tasks) return task

  return {
    ...task,
    related_tasks: Object.fromEntries(
      Object.entries(task.related_tasks).map(([kind, related]) => [
        kind,
        related
          .map((item) => removeTaskIdsFromTree(item, ids))
          .filter((item): item is Task => item !== null),
      ]),
    ),
  }
}

export function parentTitle(task: Task): string | null {
  return task.related_tasks?.parenttask?.[0]?.title ?? null
}
