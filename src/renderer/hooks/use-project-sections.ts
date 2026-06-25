import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMatches } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useProjects } from './use-projects'
import type { ProjectTreeNode } from './use-projects'
import { useCompletedTasksStore } from '@/stores/completed-tasks-store'
import { DEFAULT_PAGE_SIZE } from '@/lib/constants'
import { sortProjectTasks } from '@/lib/task-sort'
import { mergeSectionUndoWindow } from '@/lib/undo-window'
import type { Task, Project, ProjectView } from '@/lib/vikunja-types'
import type { CompletedTaskEntry } from '@/stores/completed-tasks-store'

export interface SectionData {
  project: Project
  tasks: Task[]
  viewId: number | undefined
  children: SectionData[]
}

function findNodeInTree(nodes: ProjectTreeNode[], id: number): ProjectTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeInTree(node.children, id)
    if (found) return found
  }
  return undefined
}

function collectDescendants(node: ProjectTreeNode): ProjectTreeNode[] {
  const result: ProjectTreeNode[] = []
  for (const child of node.children) {
    result.push(child)
    result.push(...collectDescendants(child))
  }
  return result
}

function buildSectionTree(
  nodes: ProjectTreeNode[],
  taskMap: Map<number, { tasks: Task[]; viewId: number | undefined }>
): SectionData[] {
  return nodes.map((node) => {
    const data = taskMap.get(node.id) ?? { tasks: [], viewId: undefined }
    return {
      project: node,
      tasks: data.tasks,
      viewId: data.viewId,
      children: buildSectionTree(node.children, taskMap),
    }
  })
}

function applyUndoWindowDeep(
  sections: SectionData[],
  completed: Map<number, CompletedTaskEntry>,
  pathname: string
): SectionData[] {
  const topMerged = mergeSectionUndoWindow(sections, completed, pathname)
  let changed = topMerged !== sections
  const result = topMerged.map((section) => {
    const mergedChildren = applyUndoWindowDeep(section.children, completed, pathname)
    if (mergedChildren !== section.children) {
      changed = true
      return { ...section, children: mergedChildren }
    }
    return section
  })
  return changed ? result : sections
}

export function useProjectSections(projectId: number) {
  const matches = useMatches()
  const pathname = matches[matches.length - 1]?.pathname ?? ''
  const completedTasks = useCompletedTasksStore((s) => s.tasks)
  const qc = useQueryClient()
  const { data: projectData } = useProjects()

  const projectNode = useMemo(
    () => findNodeInTree(projectData?.tree ?? [], projectId),
    [projectData?.tree, projectId]
  )

  const allDescendants = useMemo(
    () => (projectNode ? collectDescendants(projectNode) : []),
    [projectNode]
  )

  const allDescendantIds = useMemo(
    () => allDescendants.map((n) => n.id).sort((a, b) => a - b),
    [allDescendants]
  )

  const hasSections = (projectNode?.children.length ?? 0) > 0

  const sectionTasksQuery = useQuery({
    queryKey: ['section-tasks', projectId, allDescendantIds],
    queryFn: async () => {
      const results = await Promise.all(
        allDescendants.map(async (cp) => {
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
          if (!views) return { id: cp.id, tasks: [] as Task[], viewId: undefined }
          const listView = (views as ProjectView[]).find((v) => v.view_kind === 'list')
          if (!listView) return { id: cp.id, tasks: [] as Task[], viewId: undefined }

          const tasksResult = await api.fetchViewTasks(cp.id, listView.id, {
            filter: 'done = false',
            per_page: DEFAULT_PAGE_SIZE,
          })
          if (!tasksResult.success) return { id: cp.id, tasks: [] as Task[], viewId: listView.id }

          const tasks = sortProjectTasks(tasksResult.data as Task[])
          return { id: cp.id, tasks, viewId: listView.id }
        })
      )
      return results as { id: number; tasks: Task[]; viewId: number | undefined }[]
    },
    enabled: hasSections,
  })

  const sections = useMemo(() => {
    if (!projectNode || !sectionTasksQuery.data) return [] as SectionData[]
    const taskMap = new Map(
      sectionTasksQuery.data.map((r) => [r.id, { tasks: r.tasks, viewId: r.viewId }])
    )
    const rawTree = buildSectionTree(projectNode.children, taskMap)
    return applyUndoWindowDeep(rawTree, completedTasks, pathname)
  }, [projectNode, sectionTasksQuery.data, completedTasks, pathname])

  return {
    sections,
    hasSections,
    isLoading: sectionTasksQuery.isLoading && hasSections,
  }
}
