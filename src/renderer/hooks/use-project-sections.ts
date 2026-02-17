import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useProjects } from './use-projects'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import type { Task, Project, ProjectView } from '@/lib/vikunja-types'

export interface SectionData {
  project: Project
  tasks: Task[]
  viewId: number | undefined
}

export function useProjectSections(projectId: number) {
  const { data: projectData } = useProjects()
  const childProjects = (projectData?.flat ?? [])
    .filter((p) => p.parent_project_id === projectId)
    .sort((a, b) => a.position - b.position)

  const hasSections = childProjects.length > 0

  const sectionTasksQuery = useQuery({
    queryKey: ['section-tasks', projectId, childProjects.map((p) => p.id)],
    queryFn: async () => {
      const results = await Promise.all(
        childProjects.map(async (cp) => {
          const viewsResult = await api.fetchProjectViews(cp.id)
          if (!viewsResult.success) return { project: cp, tasks: [] as Task[], viewId: undefined }
          const listView = (viewsResult.data as ProjectView[]).find((v) => v.view_kind === 'list')
          if (!listView) return { project: cp, tasks: [] as Task[], viewId: undefined }

          const tasksResult = await api.fetchViewTasks(cp.id, listView.id, {
            filter: 'done = false',
            per_page: DEFAULT_PAGE_SIZE,
          })
          if (!tasksResult.success) return { project: cp, tasks: [] as Task[], viewId: listView.id }

          const tasks = [...(tasksResult.data as Task[])].sort((a, b) => a.position - b.position)
          return { project: cp, tasks, viewId: listView.id }
        })
      )
      return results as SectionData[]
    },
    enabled: hasSections,
  })

  return {
    sections: sectionTasksQuery.data ?? [],
    hasSections,
    isLoading: sectionTasksQuery.isLoading && hasSections,
  }
}
