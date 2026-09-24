import type { QueryClient } from '@tanstack/react-query'
import type { Task } from './vikunja-types'
import { mapTaskDoneByIds } from './task-hierarchy'

/** Keep fetched subtask arrays in sync with optimistic task completion changes. */
export function updateTaskDetailDone(
  qc: QueryClient,
  doneById: ReadonlyMap<number, boolean>,
) {
  const previous = qc.getQueriesData<Task[]>({ queryKey: ['task-detail'] })
  qc.setQueriesData<Task[]>({ queryKey: ['task-detail'] }, (old) =>
    old?.map((task) => mapTaskDoneByIds(task, doneById)),
  )
  return previous
}
