import type { ViewerFilter } from '../config'

interface FilterParams {
  filter: string
  sort_by: string
  order_by: string
  per_page: number
  page: number
  filter_include_nulls?: string
}

export function buildViewerFilterParams(viewerFilter: ViewerFilter): FilterParams {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

  // Built-in view types bypass the normal filter logic
  if (viewerFilter.view_type) {
    const eot = todayEnd.toISOString()
    const nullDate = '0001-01-01T00:00:00Z'
    switch (viewerFilter.view_type) {
      case 'today':
        return {
          filter: `done = false && due_date <= '${eot}' && due_date != '${nullDate}'`,
          sort_by: 'due_date',
          order_by: 'asc',
          per_page: 10000,
          page: 1,
        }
      case 'upcoming':
        return {
          filter: `done = false && due_date > '${eot}' && due_date != '${nullDate}'`,
          sort_by: 'due_date',
          order_by: 'asc',
          per_page: 10000,
          page: 1,
        }
      case 'anytime':
        return {
          filter: 'done = false',
          sort_by: 'updated',
          order_by: 'desc',
          per_page: 10000,
          page: 1,
        }
    }
  }

  const hasProjects = viewerFilter.project_ids && viewerFilter.project_ids.length > 0
  const includeTodayAllProjects = viewerFilter.include_today_all_projects === true

  // Build project filter clause
  let projectClause: string | null = null
  if (hasProjects) {
    if (viewerFilter.project_ids.length === 1) {
      projectClause = `project_id = ${viewerFilter.project_ids[0]}`
    } else {
      const projectConditions = viewerFilter.project_ids.map(id => `project_id = ${id}`).join(' || ')
      projectClause = `(${projectConditions})`
    }
  }

  // Build due date filter clause
  let dueDateClause: string | null = null
  if (viewerFilter.due_date_filter && viewerFilter.due_date_filter !== 'all') {
    switch (viewerFilter.due_date_filter) {
      case 'overdue':
        dueDateClause = `due_date < '${todayStart.toISOString()}' && due_date != '0001-01-01T00:00:00Z'`
        break
      case 'today':
        dueDateClause = `due_date <= '${todayEnd.toISOString()}' && due_date != '0001-01-01T00:00:00Z'`
        break
      case 'this_week': {
        const weekEnd = new Date(todayStart)
        weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()))
        weekEnd.setHours(23, 59, 59)
        dueDateClause = `due_date <= '${weekEnd.toISOString()}' && due_date != '0001-01-01T00:00:00Z'`
        break
      }
      case 'this_month': {
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        dueDateClause = `due_date <= '${monthEnd.toISOString()}' && due_date != '0001-01-01T00:00:00Z'`
        break
      }
      case 'has_due_date':
        dueDateClause = `due_date != '0001-01-01T00:00:00Z'`
        break
      case 'no_due_date':
        dueDateClause = `due_date = '0001-01-01T00:00:00Z'`
        break
    }
  }

  // Build "due today" clause for union mode
  const dueTodayClause = `due_date >= '${todayStart.toISOString()}' && due_date <= '${todayEnd.toISOString()}' && due_date != '0001-01-01T00:00:00Z'`

  let filterString = 'done = false'
  let isUnionMode = false

  if (includeTodayAllProjects && hasProjects) {
    isUnionMode = true
    const normalFilterParts: string[] = []
    if (projectClause) normalFilterParts.push(projectClause)
    if (dueDateClause) normalFilterParts.push(dueDateClause)

    const nullDueDateFromProject = projectClause
      ? `(${projectClause} && due_date = '0001-01-01T00:00:00Z')`
      : null

    if (normalFilterParts.length > 0) {
      const normalFilter = normalFilterParts.join(' && ')
      if (nullDueDateFromProject && !dueDateClause) {
        filterString += ` && ((${normalFilter}) || ${nullDueDateFromProject} || (${dueTodayClause}))`
      } else {
        filterString += ` && ((${normalFilter}) || (${dueTodayClause}))`
      }
    } else {
      filterString += ` && (${dueTodayClause})`
    }
  } else {
    if (projectClause) filterString += ` && ${projectClause}`
    if (dueDateClause) filterString += ` && ${dueDateClause}`
  }

  const sortBy = viewerFilter.sort_by || 'due_date'
  const orderBy = viewerFilter.order_by || 'asc'

  const params: FilterParams = {
    filter: filterString,
    sort_by: sortBy,
    order_by: orderBy,
    per_page: 10000,
    page: 1,
  }

  // Include nulls at end when sorting by due_date (but not in union mode)
  if (sortBy === 'due_date' && !isUnionMode) {
    params.filter_include_nulls = 'true'
  }

  return params
}
