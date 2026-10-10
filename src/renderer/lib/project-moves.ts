// Where a project goes when it is dragged in the project tree, moved with the keyboard or sent
// somewhere with "Move to…". A move can change both the parent and the place among the new
// siblings, so it is planned as a parent plus a sibling position (planSiblingMove does the
// position part, including spreading siblings out when two of them share a position).
//
// Everything here works on the active projects. A project whose parent is archived (or missing)
// is shown at the top level, so it counts as a top-level sibling here too; the Inbox is hidden in
// the sidebar but is still a real top-level sibling, so its position is taken into account.

import { planSiblingMove, type SiblingPositionUpdate } from './reorder-positions'

export interface MovableProject {
  id: number
  parent_project_id: number
  position: number
}

/** The top level: Vikunja's parent id for a project without a parent. */
export const TOP_LEVEL = 0

export type DropZone = 'before' | 'into' | 'after'

export interface ProjectPlacement {
  /** The new parent (TOP_LEVEL for the top level). */
  parentId: number
  /**
   * Whether the parent changes. A plain reorder sends only the position, so a project shown at the
   * top level because its parent is archived keeps that parent.
   */
  parentChanged: boolean
  /** The new position among the new siblings. */
  position: number
  /** Siblings that move too because there was no room between the neighbours. */
  renumbered: SiblingPositionUpdate[]
}

/** The parent a project is shown under: its own parent when that is active, else the top level. */
export function effectiveParent(project: MovableProject, projects: readonly MovableProject[]): number {
  const parent = project.parent_project_id
  return parent && projects.some((p) => p.id === parent) ? parent : TOP_LEVEL
}

/** The projects shown directly under `parentId`, in display order. */
export function childrenOf<T extends MovableProject>(projects: readonly T[], parentId: number): T[] {
  return projects
    .filter((p) => effectiveParent(p, projects) === parentId)
    .sort((a, b) => a.position - b.position)
}

/** Every project below `projectId`, at any depth. */
export function descendantIds(projectId: number, projects: readonly MovableProject[]): Set<number> {
  const result = new Set<number>()
  const pending = [projectId]
  while (pending.length > 0) {
    const id = pending.pop()!
    for (const child of childrenOf(projects, id)) {
      if (result.has(child.id)) continue
      result.add(child.id)
      pending.push(child.id)
    }
  }
  return result
}

/** Whether `projectId` can be put under `parentId`: never under itself or one of its own projects. */
export function canMoveUnder(projectId: number, parentId: number, projects: readonly MovableProject[]): boolean {
  if (parentId === TOP_LEVEL) return true
  if (parentId === projectId) return false
  return !descendantIds(projectId, projects).has(parentId)
}

/**
 * Put `projectId` under `parentId` at `index` of the new siblings (counted without the project
 * itself, like arrayMove). Null when the move is not allowed or changes nothing.
 */
export function placeAt(
  projects: readonly MovableProject[],
  projectId: number,
  parentId: number,
  index: number,
): ProjectPlacement | null {
  const moved = projects.find((p) => p.id === projectId)
  if (!moved || !canMoveUnder(projectId, parentId, projects)) return null

  const sameParent = effectiveParent(moved, projects) === parentId
  const siblings = childrenOf(projects, parentId)
  const list = sameParent ? siblings : [...siblings, moved]
  const oldIndex = list.findIndex((p) => p.id === projectId)
  const newIndex = Math.max(0, Math.min(index, list.length - 1))
  if (sameParent && oldIndex === newIndex) return null

  const plan = planSiblingMove(list, oldIndex, newIndex)
  return { parentId, parentChanged: !sameParent, position: plan.position, renumbered: plan.renumbered }
}

/** Put `projectId` before, into (as the last child) or after `targetId`. */
export function placeRelative(
  projects: readonly MovableProject[],
  projectId: number,
  targetId: number,
  zone: DropZone,
): ProjectPlacement | null {
  if (projectId === targetId) return null
  const target = projects.find((p) => p.id === targetId)
  if (!target) return null

  if (zone === 'into') {
    const children = childrenOf(projects, targetId).filter((p) => p.id !== projectId)
    return placeAt(projects, projectId, targetId, children.length)
  }

  const parentId = effectiveParent(target, projects)
  const siblings = childrenOf(projects, parentId).filter((p) => p.id !== projectId)
  const targetIndex = siblings.findIndex((p) => p.id === targetId)
  return placeAt(projects, projectId, parentId, zone === 'before' ? targetIndex : targetIndex + 1)
}

export type KeyboardMove = 'up' | 'down' | 'in' | 'out'

/**
 * The keyboard twin of a drag: up and down past the neighbouring sibling, in under the sibling
 * above (as its last child), out to the parent's level right after the parent. Null at an edge.
 * `skip` holds projects that are passed over and never nested into (the Inbox, which the sidebar
 * does not show among the projects).
 */
export function keyboardPlacement(
  projects: readonly MovableProject[],
  projectId: number,
  move: KeyboardMove,
  skip: ReadonlySet<number> = new Set(),
): ProjectPlacement | null {
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null
  const parentId = effectiveParent(project, projects)
  const siblings = childrenOf(projects, parentId).filter((p) => p.id === projectId || !skip.has(p.id))
  const index = siblings.findIndex((p) => p.id === projectId)
  const above = siblings[index - 1]
  const below = siblings[index + 1]

  switch (move) {
    case 'up':
      return above ? placeRelative(projects, projectId, above.id, 'before') : null
    case 'down':
      return below ? placeRelative(projects, projectId, below.id, 'after') : null
    case 'in':
      return above ? placeRelative(projects, projectId, above.id, 'into') : null
    case 'out':
      return parentId === TOP_LEVEL ? null : placeRelative(projects, projectId, parentId, 'after')
  }
}

/** Where the project goes back to for an undo: its old parent and its old place there. */
export function undoPlacement(
  before: readonly MovableProject[],
  now: readonly MovableProject[],
  projectId: number,
): ProjectPlacement | null {
  const old = before.find((p) => p.id === projectId)
  if (!old) return null
  const parentId = effectiveParent(old, before)
  const oldSiblings = childrenOf(before, parentId).filter((p) => p.id !== projectId)
  const oldIndex = childrenOf(before, parentId).findIndex((p) => p.id === projectId)
  // The sibling that used to follow it, if it is still there; else the old index.
  const follower = oldSiblings[oldIndex]
  const placement =
    follower && now.some((p) => p.id === follower.id && effectiveParent(p, now) === parentId)
      ? placeRelative(now, projectId, follower.id, 'before')
      : placeAt(now, projectId, parentId, oldIndex)
  // Shown at the top level only because its parent is archived: it goes back under that parent.
  if (placement && parentId === TOP_LEVEL && old.parent_project_id !== TOP_LEVEL) {
    return { ...placement, parentId: old.parent_project_id, parentChanged: true }
  }
  return placement
}

/**
 * Which part of a row the pointer is over. The top third places the project before the row and
 * the bottom third after it; the middle puts it inside. A parent whose children are shown has no
 * "after": the line would sit between it and its first child, so its lower part means inside.
 */
export function dropZone(pointerY: number, rect: { top: number; height: number }, hasVisibleChildren: boolean): DropZone {
  const offset = (pointerY - rect.top) / Math.max(1, rect.height)
  if (offset < 0.3) return 'before'
  if (offset > 0.7 && !hasVisibleChildren) return 'after'
  return 'into'
}

/** The moved project and its renumbered siblings with the placement applied (for the optimistic cache). */
export function applyPlacement<T extends MovableProject>(
  projects: readonly T[],
  projectId: number,
  placement: ProjectPlacement,
): T[] {
  const positions = new Map(placement.renumbered.map((update) => [update.id, update.position]))
  return projects.map((p) => {
    if (p.id === projectId) {
      return placement.parentChanged
        ? { ...p, parent_project_id: placement.parentId, position: placement.position }
        : { ...p, position: placement.position }
    }
    const position = positions.get(p.id)
    return position === undefined ? p : { ...p, position }
  })
}
