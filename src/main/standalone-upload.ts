// Moves tasks created in standalone (local-only) mode to a Vikunja project.

const NULL_DATE = '0001-01-01T00:00:00Z'

export interface UploadableTask {
  id: string
  title: string
  description: string
  due_date: string
}

export type UploadResult = { success: true } | { success: false; error: string }

export interface UploadDeps {
  /** Creates the task on the server. */
  upload: (payload: Record<string, unknown>) => Promise<UploadResult>
  /** Deletes the task from the local store. */
  remove: (id: string) => void
  isAuthError: (error: string) => boolean
}

export function buildStandaloneTaskPayload(task: UploadableTask): Record<string, unknown> {
  const payload: Record<string, unknown> = { title: task.title }
  if (task.description) payload.description = task.description
  if (task.due_date && task.due_date !== NULL_DATE) payload.due_date = task.due_date
  return payload
}

/**
 * Upload tasks one by one, removing each from the local store as soon as the
 * server accepted it. Clearing the store only after a fully successful run made a
 * retry after a partial failure upload the already-uploaded tasks a second time
 * (D-IPC-1). An auth error stops the run (every further request would fail too).
 */
export async function uploadStandaloneTasks(
  tasks: readonly UploadableTask[],
  deps: UploadDeps
): Promise<{ uploaded: number; errors: string[] }> {
  let uploaded = 0
  const errors: string[] = []

  for (const task of tasks) {
    const result = await deps.upload(buildStandaloneTaskPayload(task))
    if (!result.success) {
      errors.push(`"${task.title}": ${result.error}`)
      if (result.error && deps.isAuthError(result.error)) break
      continue
    }

    uploaded++
    try {
      deps.remove(task.id)
    } catch (err) {
      // Stop rather than upload more tasks that cannot be tracked as done.
      errors.push(
        `"${task.title}": uploaded, but could not be removed locally (${err instanceof Error ? err.message : String(err)})`
      )
      break
    }
  }

  return { uploaded, errors }
}
