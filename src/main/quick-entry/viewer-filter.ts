import type { ViewerFilter } from '../config'
import type { CustomList } from '../../shared/config-types'
import { filterCustomList, type CustomListTask } from '../../shared/custom-list-filter'
import { isUpcoming, toLocalDate } from '../../shared/due-dates'
import { withoutNestedSubtasks } from '../../shared/nested-subtasks'

export interface ResolvedViewerFilter {
  filter: ViewerFilter
  /** True when the viewer points at a custom list (which filters before hiding subtasks). */
  fromCustomList: boolean
}

/**
 * The filter Quick View actually applies. A viewer that points at a custom list takes that
 * list's conditions, including exclude mode, include_done, include_overdue, priorities and
 * labels. A plain filter stays as configured; its "today from all projects" option keeps meaning
 * tasks due exactly today (it has no overdue setting, and always has).
 */
export function resolveViewerFilter(
  viewerFilter: ViewerFilter,
  customLists: CustomList[] | undefined,
): ResolvedViewerFilter {
  const list = viewerFilter.custom_list_id
    ? customLists?.find((entry) => entry.id === viewerFilter.custom_list_id)
    : undefined

  if (list) {
    const { filter } = list
    return {
      fromCustomList: true,
      filter: {
        project_ids: filter.project_ids ?? [],
        project_filter_mode: filter.project_filter_mode,
        sort_by: filter.sort_by,
        order_by: filter.order_by,
        due_date_filter: filter.due_date_filter,
        include_today_all_projects: filter.include_today_all_projects,
        include_done: filter.include_done,
        include_overdue: filter.include_overdue,
        priority_filter: filter.priority_filter,
        label_ids: filter.label_ids,
      },
    }
  }

  if (viewerFilter.include_today_all_projects) {
    return { filter: { ...viewerFilter, include_overdue: false }, fromCustomList: false }
  }
  return { filter: viewerFilter, fromCustomList: false }
}

export interface SelectViewerTasksOptions {
  now?: Date
  /** The configured Inbox project; "anytime" leaves it out, like the main Anytime view. */
  inboxProjectId?: number
}

/**
 * The exact rule of the viewer filter, applied to what the (superset) server query returned.
 * Built-in views: Today is open tasks due today or earlier, Upcoming open tasks due tomorrow or
 * later, Anytime all open tasks except the Inbox. Everything else is the shared custom-list
 * evaluator, so a list shows the same tasks here and in the main window.
 */
export function selectViewerTasks<T extends CustomListTask>(
  tasks: T[],
  viewerFilter: ViewerFilter,
  options: SelectViewerTasksOptions = {},
): T[] {
  const now = options.now ?? new Date()
  const today = toLocalDate(now)

  switch (viewerFilter.view_type) {
    case 'today':
      return filterCustomList(tasks, { due_date_filter: 'today' }, today)
    case 'upcoming':
      return tasks.filter((task) => !task.done && isUpcoming(task.due_date, now))
    case 'anytime':
      return tasks.filter((task) => !task.done && !(options.inboxProjectId && task.project_id === options.inboxProjectId))
    default:
      return filterCustomList(tasks, viewerFilter, today)
  }
}

export interface SelectQuickViewTasksOptions<T> extends SelectViewerTasksOptions {
  /** Extra conditions (archived projects, hidden metadata tasks), applied before subtasks are hidden. */
  keep?: (task: T) => boolean
}

/**
 * What the Quick View shows for a fetch: the exact viewer rule, then `keep`, then (for a custom
 * list only) nested subtasks are hidden. A list fetches the un-nested set and filters first, so a
 * matching subtask whose parent does not match is still shown (cross-app semantics v1, 3.2).
 * Plain filters and built-in views arrive already de-nested by the fetch.
 */
export function selectQuickViewTasks<T extends CustomListTask>(
  tasks: T[],
  resolved: ResolvedViewerFilter,
  options: SelectQuickViewTasksOptions<T> = {},
): T[] {
  const selected = selectViewerTasks(tasks, resolved.filter, options)
  const kept = options.keep ? selected.filter(options.keep) : selected
  return resolved.fromCustomList ? withoutNestedSubtasks(kept, { hideChildrenOfCompletedParents: false }) : kept
}
