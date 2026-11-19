import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  CUSTOM_LIST_SORT_FIELDS,
  closeAction,
  isHiddenFromSidebar,
  isQuickEntryEnabled,
  isQuickViewEnabled,
  isRoutinesEnabled,
  showRoutinesInToday,
  wantsTray,
  withSidebarListHidden,
} from '../config-types'

describe('closeAction and wantsTray', () => {
  it('keeps the old rule while unset: the tray with Quick Entry or Quick View, else quit', () => {
    expect(closeAction(null)).toBe('quit')
    expect(closeAction({})).toBe('quit')
    expect(closeAction({ quick_entry_enabled: true })).toBe('tray')
    expect(closeAction({ quick_view_enabled: true })).toBe('tray')
  })

  it('follows the choice once made, whatever Quick Entry and Quick View are', () => {
    expect(closeAction({ close_action: 'minimize', quick_entry_enabled: true })).toBe('minimize')
    expect(closeAction({ close_action: 'quit', quick_view_enabled: true })).toBe('quit')
    expect(closeAction({ close_action: 'tray' })).toBe('tray')
  })

  it('reads an unknown value as unset', () => {
    expect(closeAction({ close_action: 'explode' as never, quick_entry_enabled: true })).toBe('tray')
  })

  it('wants the tray icon for Quick Entry, Quick View or hiding to the tray', () => {
    expect(wantsTray({})).toBe(false)
    expect(wantsTray({ close_action: 'minimize' })).toBe(false)
    expect(wantsTray({ close_action: 'tray' })).toBe(true)
    expect(wantsTray({ quick_entry_enabled: true, close_action: 'quit' })).toBe(true)
  })
})

describe('Quick Entry and Quick View defaults', () => {
  it('are off until the user turns them on, whatever the process reading them', () => {
    expect(isQuickViewEnabled({})).toBe(false)
    expect(isQuickViewEnabled(undefined)).toBe(false)
    expect(isQuickViewEnabled(null)).toBe(false)
    expect(isQuickEntryEnabled({})).toBe(false)
    expect(isQuickEntryEnabled(null)).toBe(false)
  })

  it('follow an explicit setting', () => {
    expect(isQuickViewEnabled({ quick_view_enabled: true })).toBe(true)
    expect(isQuickViewEnabled({ quick_view_enabled: false })).toBe(false)
    expect(isQuickEntryEnabled({ quick_entry_enabled: true })).toBe(true)
    expect(isQuickEntryEnabled({ quick_entry_enabled: false })).toBe(false)
  })
})

describe('lists hidden from the sidebar', () => {
  it('none are hidden in a config without the setting', () => {
    expect(isHiddenFromSidebar({}, 'logbook')).toBe(false)
    expect(isHiddenFromSidebar(null, 'logbook')).toBe(false)
  })

  it('a list can be hidden and shown again', () => {
    const hidden = withSidebarListHidden({}, 'logbook', true)
    expect(hidden).toEqual(['logbook'])
    expect(isHiddenFromSidebar({ sidebar_hidden_lists: hidden }, 'logbook')).toBe(true)
    expect(isHiddenFromSidebar({ sidebar_hidden_lists: hidden }, 'today')).toBe(false)
    expect(withSidebarListHidden({ sidebar_hidden_lists: hidden }, 'logbook', false)).toEqual([])
  })

  it('hiding twice keeps one entry and a name from a newer version stays', () => {
    const config = { sidebar_hidden_lists: ['calendar', 'review'] }
    expect(withSidebarListHidden(config, 'review', true)).toEqual(['calendar', 'review'])
    expect(withSidebarListHidden(config, 'review', false)).toEqual(['calendar'])
    expect(withSidebarListHidden(config, 'anytime', true)).toEqual(['calendar', 'review', 'anytime'])
  })
})

describe('routine switches', () => {
  it('are on when a config has no setting (configs from before the switches)', () => {
    expect(isRoutinesEnabled({})).toBe(true)
    expect(isRoutinesEnabled(null)).toBe(true)
    expect(showRoutinesInToday({})).toBe(true)
  })

  it('hide routines from Today when routines are off or the Today section is off', () => {
    expect(isRoutinesEnabled({ routines_enabled: false })).toBe(false)
    expect(showRoutinesInToday({ routines_enabled: false, routines_in_today: true })).toBe(false)
    expect(showRoutinesInToday({ routines_enabled: true, routines_in_today: false })).toBe(false)
    expect(showRoutinesInToday({ routines_enabled: true, routines_in_today: true })).toBe(true)
  })
})

describe('custom list sort fields', () => {
  it('offer the same keys as Android, in the same order', () => {
    expect([...CUSTOM_LIST_SORT_FIELDS]).toEqual([
      'due_date',
      'start_date',
      'end_date',
      'created',
      'updated',
      'done_at',
      'priority',
      'percent_done',
      'title',
      'done',
      'id',
      'position',
    ])
  })
})

// The config shapes used to be written out by hand in the main process and in the renderer
// (D-CFG-3). They have one definition now; a second one would drift again.
describe('one definition of the config types', () => {
  const srcDir = join(__dirname, '..', '..')

  function sourceFiles(dir: string): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue
        out.push(...sourceFiles(full))
      } else if (/\.(ts|tsx)$/.test(name)) {
        out.push(full)
      }
    }
    return out
  }

  // Read once: every test below scans the same files.
  const sources = sourceFiles(srcDir).map((file) => ({
    rel: relative(srcDir, file).split(sep).join('/'),
    text: readFileSync(file, 'utf8'),
  }))

  const shared = ['AppConfig', 'ViewerFilter', 'ReviewConfig', 'SecondaryProject', 'CustomList', 'CustomListFilter', 'ConnectionFields']

  it.each(shared)('declares %s only in src/shared/config-types.ts', (name) => {
    // A declaration, not an import of the name.
    const declaration = new RegExp(`^\\s*(?:export\\s+)?(?:interface\\s+${name}\\b|type\\s+${name}\\s*=)`, 'm')
    const offenders = sources.filter(({ rel, text }) => rel !== 'shared/config-types.ts' && declaration.test(text)).map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it('reads the Quick View setting through isQuickViewEnabled', () => {
    const exempt = ['shared/config-types.ts', 'main/config.ts']
    const offenders = sources
      .filter(({ rel, text }) => !exempt.includes(rel) && /quick_view_enabled\s*(?:!==|===)\s*(?:true|false)/.test(text))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })
})
