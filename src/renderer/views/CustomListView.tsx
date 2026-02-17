import { useEffect, useMemo, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { useTasks } from '@/hooks/use-tasks'
import { api } from '@/lib/api'
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

  if (filter.project_ids.length === 1) {
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

  // Union mode: include tasks due today from all projects
  if (filter.include_today_all_projects && filter.project_ids.length > 0) {
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

export function CustomListView() {
  const { listId } = useParams({ from: '/list/$listId' })
  const [customList, setCustomList] = useState<CustomList | null>(null)

  useEffect(() => {
    api.getConfig().then((config) => {
      const found = config?.custom_lists?.find((l) => l.id === listId)
      setCustomList(found ?? null)
    })
  }, [listId])

  const queryParams = useMemo(() => {
    if (!customList) return { filter: 'done = false' }
    return buildQueryParams(customList)
  }, [customList])

  const { data: tasks = [], isLoading } = useTasks(queryParams, !!customList)

  const filteredTasks = useMemo(() => {
    if (!customList) return tasks
    const { filter } = customList

    return tasks.filter((t: Task) => {
      // Multi-project filter (API only supports single project_id filter)
      if (filter.project_ids.length > 1 && !filter.project_ids.includes(t.project_id)) {
        return false
      }

      // Priority filter (client-side)
      if (filter.priority_filter?.length && !filter.priority_filter.includes(t.priority)) {
        return false
      }

      // Label filter (client-side)
      if (filter.label_ids?.length) {
        const taskLabelIds = (t.labels ?? []).map((l) => l.id)
        if (!filter.label_ids.some((id) => taskLabelIds.includes(id))) {
          return false
        }
      }

      return true
    })
  }, [tasks, customList])

  if (isLoading) {
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
      showNewTask={false}
      emptyTitle="No matching tasks"
      emptySubtitle="Try adjusting the list filters"
    />
  )
}
