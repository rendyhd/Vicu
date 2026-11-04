import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { apiError } from '@/lib/mutation-errors'
import { effectivePermission, isSharedProject, orderPeople, type Permission } from '@/lib/collaboration'
import type { PersonRef, Project } from '@/lib/vikunja-types'
import { useCurrentUser } from './use-current-user'
import { useProjects } from './use-projects'

// Who can see each project, and so whether what involves other people shows on its tasks (cross-app
// semantics 9.1; comments are on every task): a project is shared when its members (`users/search` with an empty query, which also counts
// owners, team members and shares inherited from a parent project) include someone who is not you.
// Members are fetched once per project, kept with the saved lists and refreshed after ten minutes.

export const MEMBERS_STALE_MS = 10 * 60 * 1000

export interface ProjectAccess {
  /** Someone besides you can see the project: assignees, unread marks and Notify me show on its tasks. */
  shared: boolean
  /** Everyone who can see it, you first. Empty while unknown. */
  members: PersonRef[]
  /** What you may do there: 0 read only, 1 read and write, 2 admin. */
  permission: Permission
}

/** A project whose members are not known yet looks private: nothing new appears until it is known to be shared. */
const PRIVATE: ProjectAccess = { shared: false, members: [], permission: 1 }

interface CollabState {
  me: PersonRef | null
  byProject: ReadonlyMap<number, ProjectAccess>
}

const CollabContext = createContext<CollabState>({ me: null, byProject: new Map() })

export function projectMembersQuery(projectId: number) {
  return {
    queryKey: ['project-members', projectId] as const,
    queryFn: async (): Promise<PersonRef[]> => {
      const result = await api.searchProjectUsers(projectId)
      if (!result.success) throw apiError(result)
      return result.data
    },
    staleTime: MEMBERS_STALE_MS,
    retry: 1,
  }
}

/** Access for each project, from its members and `max_permission`. Exported for tests. */
export function accessFor(project: Project, members: readonly PersonRef[] | undefined, me: number | null | undefined): ProjectAccess {
  const permission = effectivePermission(project.max_permission, project.is_archived)
  if (!members) {
    // Not known yet: a project someone else owns is shared with you all the same.
    const owner = project.owner
    if (owner && me !== null && me !== undefined && owner.id !== me) return { shared: true, members: [], permission }
    return permission === 1 ? PRIVATE : { ...PRIVATE, permission }
  }
  return {
    shared: isSharedProject(members.map((m) => m.id), me),
    members: orderPeople(members, me),
    permission,
  }
}

/**
 * Fetches the members of every active project and provides the access of each one to the rows,
 * the card and the comments pane.
 */
export function ProjectAccessProvider({ children }: { children: ReactNode }) {
  const { data: me } = useCurrentUser()
  const { data: projects } = useProjects()
  const active = projects?.active
  const results = useQueries({
    queries: (active ?? []).map((project) => ({ ...projectMembersQuery(project.id), enabled: !!me })),
  })

  // Rebuild only when a member list or the project list changes, not on every fetch status change.
  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  const value = useMemo<CollabState>(() => {
    const byProject = new Map<number, ProjectAccess>()
    ;(active ?? []).forEach((project, index) => {
      byProject.set(project.id, accessFor(project, results[index]?.data, me?.id))
    })
    return { me: me ?? null, byProject }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for `results`
  }, [stamp, active, me])

  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>
}

/** The access of one project; a project that is not known (or has no id) is private. */
export function useProjectAccess(projectId: number | null | undefined): ProjectAccess {
  const { byProject } = useContext(CollabContext)
  if (projectId === null || projectId === undefined) return PRIVATE
  return byProject.get(projectId) ?? PRIVATE
}

/** You, or null before the account is known. */
export function useCollabMe(): PersonRef | null {
  return useContext(CollabContext).me
}

/** The access of every active project, by id (sharing a routine looks across all of them, section 6.9). */
export function useProjectAccessMap(): ReadonlyMap<number, ProjectAccess> {
  return useContext(CollabContext).byProject
}

/** Ids of the projects that are shared, for the sidebar. */
export function useSharedProjectIds(): ReadonlySet<number> {
  const { byProject } = useContext(CollabContext)
  return useMemo(() => new Set([...byProject].filter(([, access]) => access.shared).map(([id]) => id)), [byProject])
}
