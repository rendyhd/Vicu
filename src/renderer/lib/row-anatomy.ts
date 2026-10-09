// What a task row shows on its meta line depends on the view it is in (docs/design-system-v1.md,
// section 4): a row never repeats what the view already says. Pure rules; the React side is
// components/task-list/RowViewContext.tsx.

/** What the view around a row already says. Every field is optional; the default says nothing. */
export interface RowView {
  /** The row is listed inside this project (a project or the Inbox): no project on the row. */
  projectId?: number
  /** The row is listed under this label (a Tag view): that label is not repeated. */
  labelId?: number
  /**
   * The list mixes projects without a header per project (Search, a custom list): the row names its
   * project. Grouped lists leave this off, the group header says it and a group of one passes
   * `projectMeta` to the row.
   */
  showProject?: boolean
}

export const NO_ROW_VIEW: RowView = {}

/** Where the project on a row comes from, if it shows at all. */
export type RowProjectSource = 'group' | 'lookup' | 'none'

export function rowProjectSource(taskProjectId: number, view: RowView, hasGroupProject: boolean): RowProjectSource {
  if (view.projectId !== undefined && view.projectId === taskProjectId) return 'none'
  if (hasGroupProject) return 'group'
  return view.showProject ? 'lookup' : 'none'
}

/** The labels a row shows: all of them, except the one the Tag view is already about. */
export function rowLabels<T extends { id: number }>(labels: readonly T[], view: RowView): T[] {
  return view.labelId === undefined ? [...labels] : labels.filter((label) => label.id !== view.labelId)
}

/** The checklist count of the meta line and its accessible name ("1 of 3"). */
export function checklistLabel(completed: number, total: number): string {
  return `${completed} of ${total}`
}
