import { useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { api } from '@/lib/api'
import { SAVED_FILTERS_QUERY_KEY, useSavedFilters } from '@/hooks/use-saved-filters'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useCustomList } from '@/hooks/use-custom-lists'
import { useAppConfig } from '@/hooks/use-app-config'
import { useCollabMe, useSharedProjectIds } from '@/hooks/use-project-access'
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { buildCustomListServerFilter, customListRuleParams, matchesCustomList, type CustomListContext } from '@/lib/custom-list-filter'
import { serverSortParams, sortCustomListTasks } from '@/lib/custom-list-sort'
import { toLocalDate } from '@/lib/due-dates'
import { withoutNestedSubtasks } from '@/lib/nested-subtasks'
import type { CustomList, Task, TaskQueryParams } from '@/lib/vikunja-types'

// A custom list mixes projects without a header per project, so each row names its project.
const ROW_VIEW = { showProject: true }

/**
 * The server filter is only a superset built from local-day boundaries; the exact window is
 * applied by `matchesCustomList`. Nested subtasks stay in the result so the list can filter
 * first and hide them afterwards.
 */
function buildQueryParams(list: CustomList): TaskQueryParams {
  const { filter } = list
  return {
    filter: buildCustomListServerFilter(filter),
    // The rule's dates are read in this device's zone (section 3.5).
    ...customListRuleParams(filter),
    // The order shown is applied below (sortCustomListTasks); the server only gets a sort it accepts.
    ...serverSortParams(filter.sort_by, filter.order_by),
    keep_nested_subtasks: true,
  }
}

function taskMatchesCustomList(task: Task, list: CustomList, activeProjectIds: Set<number>, context: CustomListContext): boolean {
  return activeProjectIds.has(task.project_id) && matchesCustomList(task, list.filter, toLocalDate(new Date()), context)
}

export function CustomListView() {
  const { listId } = useParams({ from: '/list/$listId' })
  const { data: customList, isLoading: isListLoading } = useCustomList(listId)
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const [creationNotice, setCreationNotice] = useState<string | null>(null)
  const { data: savedFilters } = useSavedFilters()
  const queryClient = useQueryClient()
  // An imported list says once, on this device, that it is a copy (section 3.7).
  const showImportNotice = typeof customList?.saved_filter_id === 'number'
    && savedFilters !== undefined
    && !savedFilters.notice_closed.includes(customList.id)
  const closeImportNotice = () => {
    if (!customList) return
    void api.closeSavedFilterNotice(customList.id).then((state) => queryClient.setQueryData(SAVED_FILTERS_QUERY_KEY, state))
  }
  // The server filter holds local-day boundaries for date windows. They are computed when the
  // params are built, so the day is a dependency: after midnight the filter (and with it the query
  // key) changes instead of reusing yesterday's window.
  const dayKey = useDayKey()
  // Who you are and which projects are shared, for the collaboration conditions (cross-app
  // semantics 3.3). Comment signals are already on every task list while something is shared.
  const me = useCollabMe()
  const sharedProjectIds = useSharedProjectIds()
  const context = useMemo<CustomListContext>(
    () => ({ me: me?.id ?? null, isShared: (projectId) => sharedProjectIds.has(projectId) }),
    [me, sharedProjectIds],
  )
  // A task of an "unread comments" list whose comments you read here keeps its place until you
  // leave the list, so reading the thread does not pull the row away under you.
  const readHere = useRef<{ listId: string; ids: Set<number> }>({ listId, ids: new Set() })
  if (readHere.current.listId !== listId) readHere.current = { listId, ids: new Set() }

  const queryParams = useMemo(() => {
    if (!customList) return { filter: 'done = false', keep_nested_subtasks: true }
    return buildQueryParams(customList)
  }, [customList, dayKey])

  const { data: tasks = [], isLoading } = useTasks(queryParams, !!customList)

  const destinationProjectId = useMemo(() => {
    const requested = customList?.filter.add_to_project_id ?? 0
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return requested > 0 && activeIds.has(requested) ? requested : config?.inbox_project_id
  }, [customList?.filter.add_to_project_id, projects?.flat, config?.inbox_project_id])

  const filteredTasks = useMemo(() => {
    if (!customList) return tasks
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    const keepRead = customList.filter.comments === 'unread'
    const seen = readHere.current.ids
    const matching = tasks.filter((task) => {
      if (keepRead && task.is_unread) seen.add(task.id)
      const evaluated = keepRead && !task.is_unread && seen.has(task.id) ? { ...task, is_unread: true } : task
      return taskMatchesCustomList(evaluated, customList, activeIds, context)
    })
    // The list's own sort, the same as on Android: tasks without the date last in both directions,
    // ties in the order they came in. Subtasks are hidden after sorting, so the order holds.
    const sorted = sortCustomListTasks(matching, customList.filter.sort_by, customList.filter.order_by, customList.filter.then_by ?? [])
    // A matching subtask is shown even when its parent does not match (cross-app semantics v1, 3.2).
    return withoutNestedSubtasks(sorted, { hideChildrenOfCompletedParents: false })
  }, [tasks, customList, projects?.flat, dayKey, context])

  usePrintable(
    useMemo(
      () => ({
        viewTitle: customList?.name ?? 'List',
        sections: [{ groups: [{ tasks: filteredTasks }] }],
      }),
      [customList?.name, filteredTasks]
    )
  )

  if (isLoading || isListLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading...
      </div>
    )
  }

  return (
    <RowViewProvider value={ROW_VIEW}>
    <TaskList
      title={customList?.name ?? 'List'}
      tasks={filteredTasks}
      projectId={destinationProjectId}
      showNewTask={!!destinationProjectId}
      onTaskCreated={(task) => {
        if (customList && taskMatchesCustomList(
          task,
          customList,
          new Set(projects?.flat.map((project) => project.id) ?? []),
          context,
        )) {
          setCreationNotice(null)
          return
        }
        const projectTitle = projects?.flat.find((project) => project.id === task.project_id)?.title ?? 'the destination project'
        setCreationNotice(`Task created in ${projectTitle}, but it does not currently match this list's filters.`)
        setTimeout(() => setCreationNotice(null), 6000)
      }}
      headerContent={creationNotice || showImportNotice ? (
        <>
          {showImportNotice && (
            <div className="mx-4 mb-2 flex items-start gap-2 rounded-control bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-blue" aria-hidden />
              <p className="flex-1">
                <span className="block font-medium text-[var(--text-primary)]">Imported from your server</span>
                This list is a copy of the saved filter &ldquo;{customList?.name}&rdquo;. Changes you make here stay in Vicu
                and won&apos;t update the filter on your server.
              </p>
              <button
                type="button"
                onClick={closeImportNotice}
                className="shrink-0 rounded-control px-2 py-0.5 font-medium text-accent-blue hover:bg-[var(--bg-secondary)]"
              >
                Got it
              </button>
            </div>
          )}
          {creationNotice && (
            <div className="mx-4 mb-2 rounded-control bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-secondary)]">
              {creationNotice}
            </div>
          )}
        </>
      ) : undefined}
      emptyTitle="No matching tasks"
      emptySubtitle="Try adjusting the list filters"
    />
    </RowViewProvider>
  )
}
