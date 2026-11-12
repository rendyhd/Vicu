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
import { usePrintable } from '@/stores/print-store'
import { useDayKey } from '@/stores/day-store'
import { TaskList } from '@/components/task-list/TaskList'
import { RowViewProvider } from '@/components/task-list/RowViewContext'
import { buildCustomListServerFilter, customListRuleParams, matchesCustomList, type CustomListContext } from '@/lib/custom-list-filter'
import { serverSortParams, sortCustomListTasks } from '@/lib/custom-list-sort'
import { toLocalDate } from '@/lib/due-dates'
import { withoutNestedSubtasks } from '@/lib/nested-subtasks'
import { useAvailabilityView } from '@/hooks/use-availability'
import { useProLedger } from '@/hooks/use-pro-ledger'
import { useCustomListContext } from '@/hooks/use-custom-list-context'
import { HiddenSummary, ViewSwitch } from '@/components/pro/ViewSwitch'
import { readAvailabilityView } from '../../shared/pro/availability'
import { readGroupBy, readRowFields } from '../../shared/pro/list-conditions'
import { finalVerdictOf, recordValue } from '../../shared/pro/ledger'
import { groupListTasks } from '@/lib/pro/list-groups'
import { usePersonLabels } from '@/hooks/use-people'
import { TaskRowGroup } from '@/components/task-list/TaskRowGroup'
import { TaskRow } from '@/components/task-list/TaskRow'
import { ListSectionHeader } from '@/components/task-list/ListSectionHeader'
import { TaskTable } from '@/components/task-list/TaskTable'
import { usePro } from '@/hooks/use-pro'
import { useSelectionStore } from '@/stores/selection-store'
import { cn } from '@/lib/cn'
import type { CustomList, Task, TaskQueryParams } from '@/lib/vikunja-types'


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

const TABLE_MODE_KEY = 'vicu-pro-list-table'

function readTableModes(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TABLE_MODE_KEY) ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, boolean>) : {}
  } catch {
    return {}
  }
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
  // What the conditions read besides the task (3.3, 3.8).
  const context = useCustomListContext()
  const { ledger } = useProLedger()
  const listHasView = readAvailabilityView(customList?.filter.availability) !== null
  const availability = useAvailabilityView(`list.${listId}`)
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

  // The list's own availability condition wins; without one, Pro's switch applies (21.2).
  const switchOn = availability.on && !listHasView
  const shownTasks = useMemo(() => (switchOn ? availability.filter(filteredTasks) : filteredTasks), [switchOn, availability, filteredTasks])
  const hiddenCount = switchOn ? availability.hidden(filteredTasks) : 0

  // Group by and what rows show (3.8): read on every version that knows them, Pro on or off.
  const groupBy = readGroupBy(customList?.filter.group_by)
  const rowFields = readRowFields(customList?.filter.row_fields)
  // A list mixes projects without a header per project, so each row names its project, unless the
  // groups are projects.
  const rowView = useMemo(
    () => ({ showProject: groupBy !== 'project', ...(rowFields ? { fields: rowFields } : {}) }),
    [groupBy, rowFields?.join(',')],
  )
  const personLabels = usePersonLabels()
  // Pro's table (plan 7.7.2): per list and per device; off, the list is rows as always.
  const powerOn = usePro().layer('power')
  const [tableStore, setTableStore] = useState<Record<string, boolean>>(() => readTableModes())
  const table = powerOn && tableStore[listId] === true
  const setTable = (on: boolean) => {
    const next = { ...tableStore, [listId]: on }
    setTableStore(next)
    try {
      localStorage.setItem(TABLE_MODE_KEY, JSON.stringify(next))
    } catch {
      // Remembering the mode is a convenience.
    }
  }
  const groups = useMemo(() => {
    const projectsById = new Map((projects?.flat ?? []).map((project) => [project.id, project]))
    return groupListTasks(shownTasks, groupBy, {
      today: toLocalDate(new Date()),
      projectTitle: (id) => projectsById.get(id)?.title ?? 'Project',
      projectColor: (id) => projectsById.get(id)?.hex_color,
      personOf: (task) => {
        const promise = recordValue(ledger.promises, task.id)
        const id = promise && !finalVerdictOf(promise) && typeof promise.person === 'number'
          ? promise.person
          : (task.labels ?? []).find((label) => personLabels.has(label.id))?.id
        const label = typeof id === 'number' ? personLabels.get(id) : undefined
        return label ? { id: label.id, title: label.title } : null
      },
    })
  }, [shownTasks, groupBy, projects?.flat, ledger.promises, personLabels, dayKey])

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
    <RowViewProvider value={rowView}>
    <TaskList
      title={customList?.name ?? 'List'}
      tasks={groups || table ? [] : shownTasks}
      empty={groups || table || switchOn ? shownTasks.length === 0 && hiddenCount === 0 : undefined}
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
      headerContent={creationNotice || showImportNotice || switchOn || powerOn ? (
        <>
          {powerOn && (
            <div className="mx-4 mb-2 flex justify-end">
              <div role="radiogroup" aria-label="Show as" className="flex rounded-control border border-border p-0.5">
                {(['rows', 'table'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={(mode === 'table') === table}
                    onClick={() => setTable(mode === 'table')}
                    className={cn('rounded-control px-2 py-0.5 text-meta', (mode === 'table') === table ? 'bg-bg-selected text-text' : 'text-text-secondary hover:bg-bg-hover')}
                  >
                    {mode === 'rows' ? 'Rows' : 'Table'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {switchOn && <ViewSwitch view={availability.view} onChange={availability.setView} />}
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
    >
      {table && shownTasks.length > 0 && (
        <TaskTable
          tasks={shownTasks}
          onOpen={(task) => {
            setTable(false)
            useSelectionStore.getState().requestOpenTask(task.id)
          }}
        />
      )}
      {!table && groups?.map((group) => (
        <div key={group.key} data-list-group={group.key}>
          <ListSectionHeader level={1} title={group.title} count={group.tasks.filter((task) => !task.done).length} {...(group.color !== undefined ? { dotColor: group.color ?? '' } : {})} />
          <TaskRowGroup>
            {group.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
          </TaskRowGroup>
        </div>
      ))}
      {switchOn && availability.view === 'available' && (
        <HiddenSummary count={hiddenCount} onShow={() => availability.setView('remaining')} />
      )}
    </TaskList>
    </RowViewProvider>
  )
}
