/** How far before it was queued a task may have been created and still be this create (clock skew, slow requests). */
export const DUPLICATE_WINDOW_MS = 15 * 60 * 1000

/**
 * Whether a task on the server is the one a queued create would have produced if its earlier,
 * unconfirmed attempt had gone through: same project, same title, same description, created at or
 * after the moment the create was queued (give or take the window).
 */
export function matchesQueuedCreate(
  task: unknown,
  projectId: number,
  fields: Record<string, unknown>,
  since: string
): task is { id: number } {
  if (!task || typeof task !== 'object') return false
  const t = task as { id?: unknown; title?: unknown; description?: unknown; project_id?: unknown; created?: unknown }
  if (typeof t.id !== 'number' || t.project_id !== projectId) return false
  if (t.title !== fields.title) return false
  const wanted = typeof fields.description === 'string' ? fields.description : ''
  const actual = typeof t.description === 'string' ? t.description : ''
  if (wanted !== actual) return false
  const created = typeof t.created === 'string' ? Date.parse(t.created) : NaN
  const queued = Date.parse(since)
  if (Number.isNaN(created) || Number.isNaN(queued)) return false
  return created >= queued - DUPLICATE_WINDOW_MS
}
