import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Project } from '@/lib/vikunja-types'

export interface ProjectTreeNode extends Project {
  children: ProjectTreeNode[]
}

export function buildProjectTree(projects: Project[]): ProjectTreeNode[] {
  const map = new Map<number, ProjectTreeNode>()
  const roots: ProjectTreeNode[] = []

  for (const p of projects) {
    map.set(p.id, { ...p, children: [] })
  }

  for (const node of map.values()) {
    if (node.parent_project_id && map.has(node.parent_project_id)) {
      map.get(node.parent_project_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortByPosition = (a: ProjectTreeNode, b: ProjectTreeNode) =>
    a.position - b.position
  roots.sort(sortByPosition)
  for (const node of map.values()) {
    node.children.sort(sortByPosition)
  }

  return roots
}

export function selectProjectCollections(data: Project[]) {
  const active = data.filter((project) => !project.is_archived)
  const archived = data.filter((project) => project.is_archived)
  return {
    all: data,
    active,
    archived,
    // Keep the established names active-only so every normal consumer is safe by default.
    flat: active,
    tree: buildProjectTree(active),
    fullTree: buildProjectTree(data),
  }
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const result = await api.fetchProjects(true)
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    select: selectProjectCollections,
  })
}
