import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import {
  CUSTOM_LIST_SORT_FIELDS,
  isQuickEntryEnabled,
  isQuickViewEnabled,
} from '../config-types'

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

describe('custom list sort fields', () => {
  it('offer the same keys as Android, in the same order', () => {
    expect([...CUSTOM_LIST_SORT_FIELDS]).toEqual([
      'due_date',
      'created',
      'updated',
      'priority',
      'title',
      'done_at',
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

  const shared = ['AppConfig', 'ViewerFilter', 'ReviewConfig', 'SecondaryProject', 'CustomList', 'CustomListFilter', 'ConnectionFields']

  it.each(shared)('declares %s only in src/shared/config-types.ts', (name) => {
    // A declaration, not an import of the name.
    const declaration = new RegExp(`^\\s*(?:export\\s+)?(?:interface\\s+${name}\\b|type\\s+${name}\\s*=)`, 'm')
    const offenders: string[] = []
    for (const file of sourceFiles(srcDir)) {
      const rel = relative(srcDir, file).split(sep).join('/')
      if (rel === 'shared/config-types.ts') continue
      if (declaration.test(readFileSync(file, 'utf8'))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('reads the Quick View setting through isQuickViewEnabled', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(srcDir)) {
      const rel = relative(srcDir, file).split(sep).join('/')
      if (rel === 'shared/config-types.ts' || rel === 'main/config.ts') continue
      const text = readFileSync(file, 'utf8')
      if (/quick_view_enabled\s*(?:!==|===)\s*(?:true|false)/.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
