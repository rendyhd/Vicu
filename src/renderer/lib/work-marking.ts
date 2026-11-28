import { workEntryToWrite, workProjectKey } from '../../shared/work-scope'

/**
 * The synced write that marks a project as work or not (cross-app semantics 22.7): its own entry
 * only, `null` when the project would be what the person wants without one. A top-level project, or
 * one whose parent is not listed, has a parent that is not work.
 */
export function workMarkWrite(
  project: { id: number; parent_project_id?: number | null },
  want: boolean,
  isWorkProject: (projectId: number) => boolean,
): Record<string, boolean | null> {
  const parent = project.parent_project_id
  const parentIsWork = typeof parent === 'number' && parent > 0 && isWorkProject(parent)
  return { [workProjectKey(project.id)]: workEntryToWrite(want, parentIsWork) }
}
