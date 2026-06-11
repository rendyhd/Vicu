import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useProjects } from './use-projects'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import { sortProjectTasks } from '@/lib/task-sort'
import { evictForeignCompletions } from '@/lib/undo-window'
import type { Task, Project, ProjectView } from '@/lib/vikunja-types'

export interface SectionData {
  project: Project
  tasks: Task[]
  viewId: number | undefined
}

export function useProjectSections(projectId: number) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)
  const qc = useQueryClient()
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
          const views = await qc
            .fetchQuery({
              queryKey: ['project-views', cp.id],
              queryFn: async () => {
                const result = await api.fetchProjectViews(cp.id)
                if (!result.success) throw new Error(result.error)
                return result.data
              },
              staleTime: Infinity,
            })
            .catch(() => null)
          if (!views) return { project: cp, tasks: [] as Task[], viewId: undefined }
          const listView = (views as ProjectView[]).find((v) => v.view_kind === 'list')
          if (!listView) return { project: cp, tasks: [] as Task[], viewId: undefined }

          const tasksResult = await api.fetchViewTasks(cp.id, listView.id, {
            filter: 'done = false',
            per_page: DEFAULT_PAGE_SIZE,
          })
          if (!tasksResult.success) return { project: cp, tasks: [] as Task[], viewId: listView.id }

          const tasks = sortProjectTasks(tasksResult.data as Task[])
          return { project: cp, tasks, viewId: listView.id }
        })
      )
      return results as SectionData[]
    },
    enabled: hasSections,
  })

  // Merge recently completed tasks back into each section
  const sections = useMemo(() => {
    const raw = sectionTasksQuery.data ?? []
    if (completedTasks.size === 0) return raw
    const entries = Array.from(completedTasks.values()).filter(
      (entry) => entry.path === pathname
    )

    return raw.map((section) => {
      // Drop tasks completed on another path — a completion made on the
      // subproject's own page leaks its done:true into this section cache (and
      // vice versa). Only the page where it was completed keeps it visible.
      const visible = evictForeignCompletions(section.tasks, completedTasks, pathname)
      const serverIds = new Set(visible.map((t) => t.id))
      const extras = entries
        .filter(
          (entry) =>
            entry.task.project_id === section.project.id && !serverIds.has(entry.task.id)
        )
        .map((entry) => entry.task)

      if (visible === section.tasks && extras.length === 0) return section
      return {
        ...section,
        tasks: sortProjectTasks([...visible, ...extras]),
      }
    })
  }, [sectionTasksQuery.data, completedTasks, pathname])

  return {
    sections,
    hasSections,
    isLoading: sectionTasksQuery.isLoading && hasSections,
  }
}
