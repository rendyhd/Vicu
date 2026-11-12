/**
 * Pro's switch, layers and area (docs/cross-app-semantics-v1.md section 21.1). The switch and the
 * layers are per device; the area is the synced preference `pro.area`. Off is today's Vicu: nothing
 * here may change what a device without Pro shows.
 *
 * Only imports its siblings, so every tsconfig can include it.
 */

export const PRO_LAYERS = ['availability', 'promises', 'portfolio', 'power'] as const
export type ProLayer = (typeof PRO_LAYERS)[number]
export type ProLayers = Record<ProLayer, boolean>

/** Every layer is on while Pro is on, until the person turns one off. */
export const DEFAULT_PRO_LAYERS: ProLayers = { availability: true, promises: true, portfolio: true, power: true }

/** The device settings Pro reads (desktop `AppConfig`, mobile `BehaviorPrefsStore`). */
export interface ProSwitches {
  pro_enabled?: boolean
  pro_layers?: Partial<Record<ProLayer, boolean>> | null
  standalone_mode?: boolean
}

/** The layers as stored: a missing or unreadable layer is on. */
export function readProLayers(value: unknown): ProLayers {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const layers = { ...DEFAULT_PRO_LAYERS }
  for (const layer of PRO_LAYERS) if (stored[layer] === false) layers[layer] = false
  return layers
}

/**
 * Pro is on: the switch is on and the device is not in standalone mode (Pro needs a server). With a
 * layer, that layer is on too.
 */
export function isProEnabled(config: ProSwitches | null | undefined, layer?: ProLayer): boolean {
  if (!config || config.pro_enabled !== true || config.standalone_mode === true) return false
  return layer ? readProLayers(config.pro_layers)[layer] : true
}

// --- The area (section 21.1) ------------------------------------------------------------------

/** The synced key of the area: the project categories promises and the portfolio apply in. */
export const PRO_AREA_KEY = 'pro.area'

/** The category ids of the area; none (or an unreadable value) means every project. */
export function readProArea(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const id of value) if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
  return ids
}

export interface AreaProject {
  id: number
  parent_project_id?: number | null
}

/**
 * The top-level ancestor of a project (itself when top-level), walking `parent_project_id` through
 * the projects given; a parent not given ends the walk. Cycles end the walk too.
 */
export function topLevelProjectId(projectId: number, projects: ReadonlyMap<number, AreaProject>): number {
  let current = projectId
  const seen = new Set<number>()
  for (;;) {
    seen.add(current)
    const parent = projects.get(current)?.parent_project_id
    if (!parent || parent <= 0 || !projects.has(parent) || seen.has(parent)) return current
    current = parent
  }
}

/**
 * Whether a project is in the area: the area is empty, or the category of the project's top-level
 * ancestor (`category.project.<id>`, section 13) is one of the area's categories.
 */
export function inProArea(
  projectId: number,
  area: readonly string[],
  projects: ReadonlyMap<number, AreaProject>,
  categoryOfProject: (topLevelId: number) => string | null,
): boolean {
  if (area.length === 0) return true
  const category = categoryOfProject(topLevelProjectId(projectId, projects))
  return category !== null && area.includes(category)
}
