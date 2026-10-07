/**
 * Hiding nested subtasks from a flat task list, shared by the main process (which de-nests every
 * fetch by default) and the renderer (Tag view and custom lists filter first and de-nest after,
 * cross-app semantics v1 section 3.2). Import-free.
 */

function taskId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'number' ? id : null
}

export interface NestedSubtaskOptions {
  /**
   * Also hide a task whose embedded parent is completed, even when that parent is not in the
   * list. True by default (what every fetch does). Views that filter first turn it off: a task
   * that matches is shown when its parent does not.
   */
  hideChildrenOfCompletedParents?: boolean
}

/**
 * Remove a task from the top-level list when one of its parents is in the same list, or (by
 * default) when the embedded parent is completed. Active matching children remain visible for
 * searches and filters which omit an active parent.
 */
export function withoutNestedSubtasks<T>(tasks: T[], options: NestedSubtaskOptions = {}): T[] {
  const hideChildrenOfCompletedParents = options.hideChildrenOfCompletedParents !== false
  const visibleIds = new Set(tasks.map(taskId).filter((id): id is number => id !== null))

  return tasks.filter((task) => {
    if (!task || typeof task !== 'object') return true
    const related = (task as { related_tasks?: unknown }).related_tasks
    if (!related || typeof related !== 'object') return true
    const parents = (related as { parenttask?: unknown }).parenttask
    if (!Array.isArray(parents)) return true
    return !parents.some((parent) => {
      const parentId = taskId(parent)
      const parentDone = !!parent && typeof parent === 'object'
        && (parent as { done?: unknown }).done === true
      return (hideChildrenOfCompletedParents && parentDone) || (parentId !== null && visibleIds.has(parentId))
    })
  })
}
