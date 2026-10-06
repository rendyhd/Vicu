import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useCustomList } from '@/hooks/use-custom-lists'
import { useAppConfig } from '@/hooks/use-app-config'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { buildCustomListServerFilter, matchesCustomList } from '@/lib/custom-list-filter'
import { toLocalDate } from '@/lib/due-dates'
import { withoutNestedSubtasks } from '@/lib/nested-subtasks'
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
    sort_by: filter.sort_by,
    order_by: filter.order_by,
    keep_nested_subtasks: true,
  }
}

function taskMatchesCustomList(task: Task, list: CustomList, activeProjectIds: Set<number>): boolean {
  return activeProjectIds.has(task.project_id) && matchesCustomList(task, list.filter, toLocalDate(new Date()))
}

export function CustomListView() {
  const { listId } = useParams({ from: '/list/$listId' })
  const { data: customList, isLoading: isListLoading } = useCustomList(listId)
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const [creationNotice, setCreationNotice] = useState<string | null>(null)

  const queryParams = useMemo(() => {
    if (!customList) return { filter: 'done = false', keep_nested_subtasks: true }
    return buildQueryParams(customList)
  }, [customList])

  const { data: tasks = [], isLoading } = useTasks(queryParams, !!customList)

  const destinationProjectId = useMemo(() => {
    const requested = customList?.filter.add_to_project_id ?? 0
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    return requested > 0 && activeIds.has(requested) ? requested : config?.inbox_project_id
  }, [customList?.filter.add_to_project_id, projects?.flat, config?.inbox_project_id])

  const filteredTasks = useMemo(() => {
    if (!customList) return tasks
    const activeIds = new Set(projects?.flat.map((project) => project.id) ?? [])
    const matching = tasks.filter((task) => taskMatchesCustomList(task, customList, activeIds))
    // A matching subtask is shown even when its parent does not match (cross-app semantics v1, 3.2).
    return withoutNestedSubtasks(matching, { hideChildrenOfCompletedParents: false })
  }, [tasks, customList, projects?.flat])

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
        )) {
          setCreationNotice(null)
          return
        }
        const projectTitle = projects?.flat.find((project) => project.id === task.project_id)?.title ?? 'the destination project'
        setCreationNotice(`Task created in ${projectTitle}, but it does not currently match this list's filters.`)
        setTimeout(() => setCreationNotice(null), 6000)
      }}
      headerContent={creationNotice ? (
        <div className="mx-4 mb-2 rounded-md bg-[var(--bg-hover)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          {creationNotice}
        </div>
      ) : undefined}
      emptyTitle="No matching tasks"
      emptySubtitle="Try adjusting the list filters"
    />
  )
}
