/**
 * How the sidebar is arranged (Settings → General → Sidebar): one order of the smart lists and the
 * sidebar's blocks (Pro's section, the projects, the custom lists, the labels), which the person
 * drags into place. A device setting (`config.sidebar_order`), never synced. The same rules as the
 * phone's drawer (vicu-android `DrawerLayout`), with the desktop's own keys.
 *
 * Nothing moves until the person changes it: the default is the smart lists, Pro's section, the
 * three blocks and the Logbook last. Lists placed under the last block stay in view at the bottom
 * of the sidebar instead of scrolling with the rest.
 */

/** The smart lists the sidebar can show. */
export const SIDEBAR_VIEWS = ['inbox', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review', 'logbook'] as const
export type SidebarView = (typeof SIDEBAR_VIEWS)[number]

/** The sidebar's blocks of rows under a header. */
export const SIDEBAR_BLOCKS = ['pro', 'projects', 'lists', 'labels'] as const
export type SidebarBlock = (typeof SIDEBAR_BLOCKS)[number]

/** What the person arranges: a smart list or a block. Also the name it is stored under. */
export type SidebarEntry = SidebarView | SidebarBlock

export const SIDEBAR_DEFAULT_ORDER: readonly SidebarEntry[] = [
  'inbox', 'today', 'plan', 'routines', 'upcoming', 'anytime', 'review',
  'pro', 'projects', 'lists', 'labels',
  'logbook',
]

export function isSidebarBlock(entry: string): entry is SidebarBlock {
  return (SIDEBAR_BLOCKS as readonly string[]).includes(entry)
}

export function isSidebarView(entry: string): entry is SidebarView {
  return (SIDEBAR_VIEWS as readonly string[]).includes(entry)
}

/**
 * Every entry in the person's order. `stored` is the order as it was saved; an entry it does not
 * name (one added since) comes right after the entry before it in the default order, and a name
 * this version does not know is left out.
 */
export function sidebarOrder(stored: readonly string[] | null | undefined): SidebarEntry[] {
  const known = new Set<string>(SIDEBAR_DEFAULT_ORDER)
  const result: SidebarEntry[] = []
  for (const key of stored ?? []) {
    if (known.has(key) && !result.includes(key as SidebarEntry)) result.push(key as SidebarEntry)
  }
  SIDEBAR_DEFAULT_ORDER.forEach((entry, index) => {
    if (result.includes(entry)) return
    const before = SIDEBAR_DEFAULT_ORDER.slice(0, index).reverse().find((earlier) => result.includes(earlier))
    result.splice(before === undefined ? 0 : result.indexOf(before) + 1, 0, entry)
  })
  return result
}

/** Whether `stored` is the default order (nothing to reset). */
export function isDefaultSidebarOrder(stored: readonly string[] | null | undefined): boolean {
  return sidebarOrder(stored).every((entry, index) => entry === SIDEBAR_DEFAULT_ORDER[index])
}

/** What Settings lists, in order: the entries that exist now (`offered`), shown in the sidebar or not. */
export function arrangeableSidebar(stored: readonly string[] | null | undefined, offered: ReadonlySet<string>): SidebarEntry[] {
  return sidebarOrder(stored).filter((entry) => offered.has(entry))
}

/**
 * The whole order after the entries Settings lists were put in `arranged`: they trade places among
 * themselves, and an entry that is not listed there now (Plan while the planner is off) stays where
 * it was. Returned as the names to store.
 */
export function sidebarOrderAfterArranging(stored: readonly string[] | null | undefined, arranged: readonly SidebarEntry[]): SidebarEntry[] {
  const moving = new Set<SidebarEntry>(arranged)
  let next = 0
  return sidebarOrder(stored).map((entry) => (moving.has(entry) && next < arranged.length ? arranged[next++] : entry))
}

/** `list` with the entry at `from` moved to `to`; unchanged when either is out of range. */
export function movedEntry<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list]
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return result
  const [entry] = result.splice(from, 1)
  result.splice(to, 0, entry)
  return result
}

/**
 * A stretch of the sidebar: smart lists that follow each other, or one block. `pinned` lists are
 * the ones under the last block: they are drawn outside the scrolling part, above the footer.
 */
export type SidebarGroup =
  | { kind: 'views'; views: SidebarView[]; pinned: boolean }
  | { kind: 'block'; block: SidebarBlock }

/** What the sidebar draws, top to bottom: the entries of `shown` in the person's order, in groups. */
export function sidebarGroups(stored: readonly string[] | null | undefined, shown: ReadonlySet<string>): SidebarGroup[] {
  const groups: SidebarGroup[] = []
  for (const entry of sidebarOrder(stored)) {
    if (!shown.has(entry)) continue
    if (isSidebarBlock(entry)) {
      groups.push({ kind: 'block', block: entry })
      continue
    }
    const last = groups[groups.length - 1]
    if (last?.kind === 'views') last.views.push(entry)
    else groups.push({ kind: 'views', views: [entry], pinned: false })
  }
  const last = groups[groups.length - 1]
  if (last?.kind === 'views' && groups.some((group) => group.kind === 'block')) last.pinned = true
  return groups
}
