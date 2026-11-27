import { describe, expect, it } from 'vitest'
import {
  clampSidebarWidth,
  CONTENT_MIN_WIDTH,
  dockedSidebarWidth,
  DRAWER_GAP,
  drawerWidth,
  isNarrowWindow,
  maxDockedWidth,
  NARROW_BELOW,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SPLITTER_WIDTH,
  sidebarPlacement,
  sidebarShown,
} from '../sidebar-width'

describe('sidebar width (rendyhd/Vicu#73)', () => {
  it('turns into a drawer where the narrowest sidebar would squeeze the content', () => {
    expect(NARROW_BELOW).toBe(SIDEBAR_MIN_WIDTH + SPLITTER_WIDTH + CONTENT_MIN_WIDTH)
    expect(isNarrowWindow(NARROW_BELOW - 1)).toBe(true)
    expect(isNarrowWindow(NARROW_BELOW)).toBe(false)
    expect(isNarrowWindow(360)).toBe(true)
    expect(isNarrowWindow(1280)).toBe(false)
    // Not measured yet: the wide layout, as before.
    expect(isNarrowWindow(0)).toBe(false)
  })

  it('keeps a stored width within the limits', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(500)).toBe(SIDEBAR_MAX_WIDTH)
    expect(clampSidebarWidth(250.4)).toBe(250)
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH)
  })

  it('gives way to the content as the window shrinks, down to its minimum', () => {
    expect(dockedSidebarWidth(300, 1280)).toBe(300)
    expect(maxDockedWidth(800)).toBe(800 - SPLITTER_WIDTH - CONTENT_MIN_WIDTH)
    expect(dockedSidebarWidth(360, 800)).toBe(316)
    expect(dockedSidebarWidth(240, 800)).toBe(240)
    expect(dockedSidebarWidth(300, NARROW_BELOW)).toBe(SIDEBAR_MIN_WIDTH)
    // The content column is never narrower than its minimum while the sidebar is beside it.
    for (const width of [NARROW_BELOW, 700, 800, 900]) {
      expect(width - SPLITTER_WIDTH - dockedSidebarWidth(SIDEBAR_MAX_WIDTH, width)).toBeGreaterThanOrEqual(CONTENT_MIN_WIDTH)
    }
  })

  it('leaves a strip of the content beside the drawer', () => {
    expect(drawerWidth(240, 600)).toBe(240)
    expect(drawerWidth(360, 360)).toBe(360 - DRAWER_GAP)
    expect(drawerWidth(200, 360)).toBe(200)
  })

  it('places the sidebar by the window and the two choices', () => {
    expect(sidebarPlacement(false, false, false)).toBe('docked')
    expect(sidebarPlacement(false, true, false)).toBe('hidden')
    // A narrow window has the drawer whatever the wide window's choice.
    expect(sidebarPlacement(true, true, false)).toBe('drawer-closed')
    expect(sidebarPlacement(true, false, true)).toBe('drawer-open')
    expect(sidebarShown('docked')).toBe(true)
    expect(sidebarShown('drawer-open')).toBe(true)
    expect(sidebarShown('hidden')).toBe(false)
    expect(sidebarShown('drawer-closed')).toBe(false)
  })
})
