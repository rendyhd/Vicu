export interface CustomListClientFilter {
  project_ids?: number[]
  project_filter_mode?: 'include' | 'exclude'
  priority_filter?: number[]
  label_ids?: number[]
}

interface FilterableTask {
  project_id?: number
  priority?: number
  labels?: Array<{ id: number }>
}

/**
 * Client-side leg of custom-list filtering for the Quick View. Mirrors the
 * main window's CustomListView.filteredTasks: exclude-mode projects,
 * priorities, and labels can't be expressed in the Vikunja filter string the
 * viewer builds, so they're applied to the fetched set here.
 */
export function applyCustomListTaskFilter<T extends FilterableTask>(
  tasks: T[],
  filter: CustomListClientFilter
): T[] {
  return tasks.filter((t) => {
    if (filter.project_filter_mode === 'exclude' && filter.project_ids?.length) {
      if (filter.project_ids.includes(t.project_id as number)) return false
    }
    if (filter.priority_filter?.length && !filter.priority_filter.includes(t.priority ?? 0)) {
      return false
    }
    if (filter.label_ids?.length) {
      const taskLabelIds = (t.labels ?? []).map((l) => l.id)
      if (!filter.label_ids.some((id) => taskLabelIds.includes(id))) return false
    }
    return true
  })
}
