/**
 * Focus (docs/cross-app-semantics-v1.md section 21.14): a device-only view of some categories and
 * projects. Never synced; described so both apps filter the same way. Both apps run the `pro.focus`
 * vectors.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */
import { topLevelProjectId, type AreaProject } from './settings'

export interface ProFocus {
  categories: string[]
  projects: number[]
}

/** The stored focus, or null when there is none (or nothing in it). */
export function readProFocus(value: unknown): ProFocus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const stored = value as Record<string, unknown>
  const categories = Array.isArray(stored.categories) ? stored.categories.filter((id): id is string => typeof id === 'string' && id !== '') : []
  const projects = Array.isArray(stored.projects)
    ? stored.projects.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
    : []
  return categories.length || projects.length ? { categories, projects } : null
}

/**
 * A project is in focus when it or an ancestor is a focused project, or its top-level ancestor's
 * category is a focused category. The Inbox is always in focus (capture never hides). No focus: all.
 */
export function inFocus(
  projectId: number,
  focus: ProFocus | null,
  projects: ReadonlyMap<number, AreaProject>,
  categoryOfProject: (topLevelId: number) => string | null,
  inboxProjectId: number | null,
): boolean {
  if (!focus) return true
  if (projectId === inboxProjectId) return true
  const seen = new Set<number>()
  let current: number | null | undefined = projectId
  while (typeof current === 'number' && current > 0 && !seen.has(current)) {
    if (focus.projects.includes(current)) return true
    seen.add(current)
    const parent: number | null | undefined = projects.get(current)?.parent_project_id
    current = parent && projects.has(parent) ? parent : null
  }
  const category = categoryOfProject(topLevelProjectId(projectId, projects))
  return category !== null && focus.categories.includes(category)
}

/**
 * The projects the sidebar shows in focus: those in focus and the ancestors of a focused project (so
 * the tree keeps its path).
 */
export function projectsShownInFocus(
  focus: ProFocus | null,
  projects: ReadonlyMap<number, AreaProject>,
  categoryOfProject: (topLevelId: number) => string | null,
  inboxProjectId: number | null,
): Set<number> {
  const shown = new Set<number>()
  for (const id of projects.keys()) {
    if (!inFocus(id, focus, projects, categoryOfProject, inboxProjectId)) continue
    shown.add(id)
    let parent = projects.get(id)?.parent_project_id
    const seen = new Set<number>([id])
    while (parent && projects.has(parent) && !seen.has(parent)) {
      shown.add(parent)
      seen.add(parent)
      parent = projects.get(parent)?.parent_project_id
    }
  }
  return shown
}
