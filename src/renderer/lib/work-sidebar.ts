import type { WorkMode } from '../../shared/work-scope'

/**
 * What the sidebar's project tree draws in Work or Personal (cross-app semantics 22.5). Only what is
 * drawn is narrowed: drops, moves and positions are planned against every project.
 */

/**
 * The node with its subtree cut to the listed projects, as a list of one or none. `shown` null
 * lists everything. A node that is not listed is dropped with its subtree: the listed set always
 * holds every project above a listed one, so a tree is never cut in the middle.
 */
export function pruneToListed<T extends { id: number; children: T[] }>(node: T, shown: ReadonlySet<number> | null): T[] {
  if (!shown) return [node]
  if (!shown.has(node.id)) return []
  return [{ ...node, children: node.children.flatMap((child) => pruneToListed(child, shown)) }]
}

/**
 * Whether a category's header is drawn while the tree is narrowed (by the mode or by Pro's focus):
 * when one of its top-level projects is listed. A category without any project is nobody's work
 * yet, so it stays in All and Personal; Pro's focus hides it.
 */
export function categoryHeaderListed(input: {
  /** The category's top-level projects that are drawn. */
  listed: number
  /** Every top-level project the category holds. */
  total: number
  mode: WorkMode
  focusActive: boolean
}): boolean {
  if (input.listed > 0) return true
  return input.total === 0 && !input.focusActive && input.mode !== 'work'
}
