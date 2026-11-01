import { useCallback, useMemo } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { APP_CONFIG_QUERY_KEY, useAppConfig } from './use-app-config'
import { useProjects } from './use-projects'
import { SYNCED_PREFS_QUERY_KEY, useSyncedPrefs, writeSyncedPrefs } from './use-synced-prefs'
import { announce } from '@/stores/announcer-store'
import { toast, UNDO_TOAST_MS } from '@/stores/toast-store'
import type { AppConfig, Project } from '@/lib/vikunja-types'
import type { ProjectMove } from '@/lib/project-category-moves'
import type { ProjectActions } from './use-project-actions'
import {
  categoryLayout,
  groupOfProject,
  planAddCategoryAbove,
  planAssignProject,
  planDeleteCategory,
  planMoveCategory,
  planNewCategory,
  planRenameCategory,
  projectCategoryKey,
  usableCategories,
  type CategoryWrites,
} from '../../shared/project-categories'
import type { SyncedPrefsSnapshot } from '../../shared/synced-prefs'

const DELETE_TOAST_KEY = 'category-delete'

/**
 * Sends a project move planned with project-category-moves.ts: the parent and position through the
 * project actions (with their Undo toast for a new parent), and the project's category entry when
 * it changes.
 */
export function commitProjectMove(
  qc: QueryClient,
  moveProject: ProjectActions['move'],
  project: Project,
  move: ProjectMove,
  spoken?: string,
): void {
  if (move.placement) moveProject(project, move.placement, spoken)
  if (move.category !== undefined) void writeSyncedPrefs(qc, { [projectCategoryKey(project.id)]: move.category })
}

/**
 * The project categories (cross-app semantics section 13) from the synced preferences: the usable
 * categories in display order and the groups of the project list (the projects without a category
 * first, then each category with its top-level projects).
 */
export function useProjectCategories() {
  const { snapshot } = useSyncedPrefs()
  const { data } = useProjects()
  const { data: config } = useAppConfig()
  const inboxId = config?.inbox_project_id ?? 0
  const values = snapshot.values
  const categories = useMemo(() => usableCategories(values), [values])
  const layout = useMemo(() => categoryLayout(data?.active ?? [], inboxId, values), [data?.active, inboxId, values])
  return { categories, layout, values }
}

function valuesOf(qc: QueryClient): Record<string, unknown> {
  return qc.getQueryData<SyncedPrefsSnapshot>(SYNCED_PREFS_QUERY_KEY)?.values ?? {}
}

function activeProjects(qc: QueryClient): Project[] {
  return (qc.getQueryData<Project[]>(['projects']) ?? []).filter((project) => !project.is_archived)
}

function inboxOf(qc: QueryClient): number {
  return qc.getQueryData<AppConfig | null>(APP_CONFIG_QUERY_KEY)?.inbox_project_id ?? 0
}

function nameOf(values: Record<string, unknown>, categoryId: string | null): string | null {
  if (categoryId === null) return null
  return usableCategories(values).find((category) => category.id === categoryId)?.name ?? null
}

function newCategoryId(): string {
  return crypto.randomUUID()
}

/**
 * What can be done to categories, from the sidebar's headers, the project menu and Settings. Every
 * change is planned on the values as they are when it runs and written in one go, so it works after
 * the menu that asked for it has closed.
 */
export function useProjectCategoryActions() {
  const qc = useQueryClient()

  const write = useCallback((writes: CategoryWrites | null) => (writes ? writeSyncedPrefs(qc, writes) : Promise.resolve(false)), [qc])

  /** A new category, last. Returns its id. */
  const create = useCallback(
    async (name: string): Promise<string | null> => {
      const id = newCategoryId()
      if (!(await write(planNewCategory(valuesOf(qc), id, name)))) return null
      announce(`Created category “${name.trim()}”`)
      return id
    },
    [qc, write],
  )

  const rename = useCallback(
    (categoryId: string, name: string) => void write(planRenameCategory(valuesOf(qc), categoryId, name)),
    [qc, write],
  )

  /** One place up (-1) or down (+1) among the categories. */
  const moveBy = useCallback(
    (categoryId: string, delta: -1 | 1) => {
      const values = valuesOf(qc)
      const order = usableCategories(values).map((category) => category.id)
      const index = order.indexOf(categoryId)
      if (index < 0) return
      void write(planMoveCategory(values, categoryId, index + delta))
      announce(`Moved “${nameOf(values, categoryId)}” ${delta < 0 ? 'up' : 'down'}`)
    },
    [qc, write],
  )

  /** Deletes a category; its projects stay, without one. Undo writes back every entry it cleared. */
  const remove = useCallback(
    async (categoryId: string) => {
      const values = valuesOf(qc)
      const name = nameOf(values, categoryId) ?? ''
      const writes = planDeleteCategory(values, categoryId)
      const previous: CategoryWrites = {}
      for (const key of Object.keys(writes)) previous[key] = values[key] ?? null
      if (!(await write(writes))) return
      const message = `Deleted category “${name}”`
      toast.success(message, {
        key: DELETE_TOAST_KEY,
        durationMs: UNDO_TOAST_MS,
        action: { label: 'Undo', onAction: () => void write(previous) },
      })
      announce(message)
    },
    [qc, write],
  )

  /** A top-level project moved to a category (`null`: to none) from a menu. */
  const assign = useCallback(
    async (project: Pick<Project, 'id' | 'title'>, categoryId: string | null) => {
      const values = valuesOf(qc)
      const layout = categoryLayout(activeProjects(qc), inboxOf(qc), values)
      const from = groupOfProject(layout, project.id)?.category?.name ?? null
      const writes = planAssignProject(values, project.id, categoryId)
      if (Object.keys(writes).length === 0 || !(await write(writes))) return
      const to = nameOf(valuesOf(qc), categoryId)
      const message = to ? `Moved “${project.title}” to ${to}` : `Moved “${project.title}” out of ${from ?? 'its category'}`
      toast.success(message)
      announce(message)
    },
    [qc, write],
  )

  /** "New category" from a project's menu: the category, last, with the project in it. */
  const createWithProject = useCallback(
    async (name: string, project: Pick<Project, 'id' | 'title'>) => {
      const values = valuesOf(qc)
      const id = newCategoryId()
      const writes = { ...planNewCategory(values, id, name), ...planAssignProject(values, project.id, id) }
      if (!(await write(writes))) return
      const message = `Moved “${project.title}” to ${name.trim()}`
      toast.success(message)
      announce(message)
    },
    [qc, write],
  )

  /** "Add category above": the new category starts at this project and takes the ones after it. */
  const addAbove = useCallback(
    async (project: Pick<Project, 'id'>, name: string) => {
      const writes = planAddCategoryAbove(activeProjects(qc), inboxOf(qc), valuesOf(qc), project.id, newCategoryId(), name)
      if (writes && (await write(writes))) announce(`Created category “${name.trim()}”`)
    },
    [qc, write],
  )

  return useMemo(
    () => ({ create, rename, moveBy, remove, assign, createWithProject, addAbove }),
    [create, rename, moveBy, remove, assign, createWithProject, addAbove],
  )
}
