/**
 * How wide the sidebar is drawn, and when it stops sitting beside the content (rendyhd/Vicu#73).
 *
 * A window narrower than `NARROW_BELOW` has no room for the narrowest sidebar and a usable content
 * column, so the sidebar becomes a drawer over the content, opened by the sidebar button or Mod+\.
 * Above it the sidebar sits beside the content as before, at the width the person dragged it to,
 * but never so wide that the content column gets narrower than `CONTENT_MIN_WIDTH`: it gives way
 * as the window shrinks instead of the content. The person can also hide it in a wide window.
 */

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_DEFAULT_WIDTH = 240
/** The resize handle between the sidebar and the content. */
export const SPLITTER_WIDTH = 4
/** The narrowest content column beside the sidebar. */
export const CONTENT_MIN_WIDTH = 480
/** The strip of content left visible beside an open drawer (a click there closes it). */
export const DRAWER_GAP = 48
/** Windows narrower than this show the sidebar as a drawer. */
export const NARROW_BELOW = SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + CONTENT_MIN_WIDTH

/** Whether a window of this width shows the sidebar as a drawer. 0 means not measured yet. */
export function isNarrowWindow(windowWidth: number): boolean {
  return windowWidth > 0 && windowWidth < NARROW_BELOW
}

/** A stored or dragged width within the sidebar's limits. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

/** The widest the sidebar may be beside the content in a window this wide. */
export function maxDockedWidth(windowWidth: number): number {
  if (windowWidth <= 0) return SIDEBAR_MAX_WIDTH
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, windowWidth - SPLITTER_WIDTH - CONTENT_MIN_WIDTH))
}

/** The width the sidebar is drawn at beside the content: the person's width, given way as needed. */
export function dockedSidebarWidth(stored: number, windowWidth: number): number {
  return Math.min(clampSidebarWidth(stored), maxDockedWidth(windowWidth))
}

/** The width of the drawer: the person's width, leaving `DRAWER_GAP` of the content in view. */
export function drawerWidth(stored: number, windowWidth: number): number {
  const room = windowWidth > 0 ? windowWidth - DRAWER_GAP : SIDEBAR_MAX_WIDTH
  return Math.max(0, Math.min(clampSidebarWidth(stored), room))
}

/**
 * Where the sidebar is: beside the content (`docked`), hidden by the person in a wide window
 * (`hidden`), or a drawer that is open or closed. A narrow window always has the drawer, whatever
 * the wide window's choice, and a drawer starts closed.
 */
export type SidebarPlacement = 'docked' | 'hidden' | 'drawer-open' | 'drawer-closed'

export function sidebarPlacement(narrow: boolean, hiddenWhenWide: boolean, drawerOpen: boolean): SidebarPlacement {
  if (narrow) return drawerOpen ? 'drawer-open' : 'drawer-closed'
  return hiddenWhenWide ? 'hidden' : 'docked'
}

/** Whether the sidebar's lists can be seen (the button's state). */
export function sidebarShown(placement: SidebarPlacement): boolean {
  return placement === 'docked' || placement === 'drawer-open'
}
