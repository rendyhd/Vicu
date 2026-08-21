import type { Task } from '@/lib/vikunja-types'
import { confirmDelete } from '@/lib/confirm-bridge'
import { unfinishedDescendants } from '@/lib/task-hierarchy'

export async function confirmTaskCompletion(task: Task): Promise<boolean> {
  const count = unfinishedDescendants(task).length
  if (count === 0) return true
  return confirmDelete(
    `Complete this task and ${count} unfinished ${count === 1 ? 'subtask' : 'subtasks'}?`,
    { force: true, confirmLabel: 'Complete all', destructive: false },
  )
}
