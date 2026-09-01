import { useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { useProjects } from '@/hooks/use-projects'
import { useCustomList } from '@/hooks/use-custom-lists'
import { useAppConfig } from '@/hooks/use-app-config'
import { usePrintable } from '@/stores/print-store'
import { TaskList } from '@/components/task-list/TaskList'
import { NULL_DATE } from '@/lib/constants'
import type { CustomList, Task, TaskQueryParams } from '@/lib/vikunja-types'

function endOfToday(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfWeek(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? 0 : 7 - day
  d.setDate(d.getDate() + diff)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function endOfMonth(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

function buildQueryParams(list: CustomList): TaskQueryParams {
  const { filter } = list
  const parts: string[] = []

  if (!filter.include_done) {
    parts.push('done = false')
  }

  if ((filter.project_filter_mode ?? 'include') === 'include' && filter.project_ids.length === 1) {
    parts.push(`project_id = ${filter.project_ids[0]}`)
  }

  switch (filter.due_date_filter) {
    case 'overdue':
      parts.push(`due_date < '${startOfToday()}'`)
      parts.push(`due_date != '${NULL_DATE}'`)
      break
    case 'today':
      parts.push(`due_date <= '${endOfToday()}'`)
      parts.push(`due_date != '${NULL_DATE}'`)
      break
    case 'this_week':
      parts.push(`due_date <= '${endOfWeek()}'`)
      parts.push(`due_date != '${NULL_DATE}'`)
      break
    case 'this_month':
      parts.push(`due_date <= '${endOfMonth()}'`)
      parts.push(`due_date != '${NULL_DATE}'`)
      break
    case 'has_due_date':
      parts.push(`due_date != '${NULL_DATE}'`)
      break
    case 'no_due_date':
      parts.push(`due_date = '${NULL_DATE}'`)
      break
  }

  // Union mode: include tasks due today from all projects (only for include mode)
  if (filter.include_today_all_projects && filter.project_ids.length > 0 && (filter.project_filter_mode ?? 'include') === 'include') {
    const basePart = parts.length > 0 ? parts.join(' && ') : null
    const dueTodayClause = `due_date >= '${startOfToday()}' && due_date <= '${endOfToday()}' && due_date != '${NULL_DATE}'`

    if (basePart) {
      return {
        filter: `done = false && ((${basePart}) || (${dueTodayClause}))`,
        sort_by: filter.sort_by,
        order_by: filter.order_by,
      }
    }
  }

  return {
    filter: parts.length > 0 ? parts.join(' && ') : undefined,
    sort_by: filter.sort_by,
    order_by: filter.order_by,
  }
}

function taskMatchesCustomList(task: Task, list: CustomList, activeProjectIds: Set<number>): boolean {
  const { filter } = list
  if (!activeProjectIds.has(task.project_id) || (!filter.include_done && task.done)) return false

  const dueTime = task.due_date && task.due_date !== NULL_DATE ? new Date(task.due_date).getTime() : null
  const todayStart = new Date(startOfToday()).getTime()
  const todayEnd = new Date(endOfToday()).getTime()
  const dueTodayUnion = filter.include_today_all_projects && dueTime !== null && dueTime >= todayStart && dueTime <= todayEnd
  if (!dueTodayUnion && filter.project_ids.length > 0) {
    const listed = filter.project_ids.includes(task.project_id)
    if ((filter.project_filter_mode ?? 'include') === 'exclude' ? listed : !listed) return false
  }

  const dueLimit = filter.due_date_filter === 'this_week' ? new Date(endOfWeek()).getTime()
    : filter.due_date_filter === 'this_month' ? new Date(endOfMonth()).getTime()
      : todayEnd
  if (!dueTodayUnion) {
    if (filter.due_date_filter === 'overdue' && (dueTime === null || dueTime >= todayStart)) return false
    if (filter.due_date_filter === 'today' && (dueTime === null || dueTime > todayEnd)) return false
    if (['this_week', 'this_month'].includes(filter.due_date_filter) && (dueTime === null || dueTime > dueLimit)) return false
    if (filter.due_date_filter === 'has_due_date' && dueTime === null) return false
    if (filter.due_date_filter === 'no_due_date' && dueTime !== null) return false
  }
  if (filter.priority_filter?.length && !filter.priority_filter.includes(task.priority)) return false
  if (filter.label_ids?.length) {
    const taskLabelIds = new Set((task.labels ?? []).map((label) => label.id))
    if (!filter.label_ids.some((id) => taskLabelIds.has(id))) return false
  }
  return true
}

export function CustomListView() {
  const { listId } = useParams({ from: '/list/$listId' })
  const { data: customList, isLoading: isListLoading } = useCustomList(listId)
  const { data: projects } = useProjects()
  const { data: config } = useAppConfig()
  const [creationNotice, setCreationNotice] = useState<string | null>(null)

  const queryParams = useMemo(() => {
    if (!customList) return { filter: 'done = false' }
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
    return tasks.filter((task) => taskMatchesCustomList(task, customList, activeIds))
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
