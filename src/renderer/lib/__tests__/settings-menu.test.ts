import { describe, expect, it } from 'vitest'
import {
  currentSectionIndex,
  SECTION_READ_OFFSET,
  SETTINGS_CONTENT_MIN,
  SETTINGS_GROUPS,
  SETTINGS_MENU_WIDTH,
  settingsMenuInSidebar,
  settingsTabLabel,
} from '../settings-menu'

describe('settings menu', () => {
  it('lists every tab once', () => {
    const keys = SETTINGS_GROUPS.flatMap((g) => g.tabs.map((t) => t.key))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(7)
    expect(settingsTabLabel('integrations')).toBe('Quick Entry / View')
  })

  it('moves into the sidebar only when the column and the settings do not fit', () => {
    const fits = SETTINGS_MENU_WIDTH + SETTINGS_CONTENT_MIN
    expect(settingsMenuInSidebar(0)).toBe(false)
    expect(settingsMenuInSidebar(fits - 1)).toBe(true)
    expect(settingsMenuInSidebar(fits)).toBe(false)
    // The smallest window (800 px) with the default sidebar (240 px) and splitter.
    expect(settingsMenuInSidebar(800 - 240 - 4)).toBe(true)
    // The default window (1280 px).
    expect(settingsMenuInSidebar(1280 - 240 - 4)).toBe(false)
  })

  it('follows the last heading above the reading line', () => {
    expect(currentSectionIndex([], false)).toBe(-1)
    expect(currentSectionIndex([200, 600], false)).toBe(0)
    expect(currentSectionIndex([-400, SECTION_READ_OFFSET, 500], false)).toBe(1)
    expect(currentSectionIndex([-900, -300, 300], true)).toBe(2)
  })
})
