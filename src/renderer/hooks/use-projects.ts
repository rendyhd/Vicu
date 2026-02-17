import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Project } from '@/lib/vikunja-types'

export interface ProjectTreeNode extends Project {
  children: ProjectTreeNode[]
}

function buildProjectTree(projects: Project[]): ProjectTreeNode[] {
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

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const result = await api.fetchProjects()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
    select: (data) => ({
      flat: data,
      tree: buildProjectTree(data),
    }),
  })
}
