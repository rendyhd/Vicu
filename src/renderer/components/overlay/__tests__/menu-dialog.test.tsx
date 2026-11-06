import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MenuHeading, MenuItem, MenuRadioItem, MenuSeparator } from '../Menu'
import { OPTION_SELECTOR, optionLabel } from '../popover-logic'

const root = resolve(__dirname, '..', '..', '..')

// Card 3.2a (D-20). The behaviour (focus, Escape, light dismiss) is checked in the running app by
// the scenarios context-menu-keys, dialog-keys and picker-keys.

describe('Menu items', () => {
  it('are buttons with the menu roles and are not tab stops', () => {
    const item = renderToStaticMarkup(<MenuItem>Copy task</MenuItem>)
    expect(item).toContain('role="menuitem"')
    expect(item).toContain('tabindex="-1"')
    expect(item).toContain('data-typeahead="Copy task"')

    const radio = renderToStaticMarkup(<MenuRadioItem checked>High</MenuRadioItem>)
    expect(radio).toContain('role="menuitemradio"')
    expect(radio).toContain('aria-checked="true"')
    expect(renderToStaticMarkup(<MenuRadioItem checked={false}>Low</MenuRadioItem>)).toContain('aria-checked="false"')
  })

  it('keep the icon column even without an icon, so labels line up', () => {
    const html = renderToStaticMarkup(<MenuItem>Clear date</MenuItem>)
    expect(html).toContain('h-4 w-4 shrink-0')
  })

  it('announce a picker they open', () => {
    const html = renderToStaticMarkup(<MenuItem popup="listbox" expanded>Move to project</MenuItem>)
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-expanded="true"')
    const plain = renderToStaticMarkup(<MenuItem>Copy task</MenuItem>)
    expect(plain).not.toContain('aria-haspopup')
    expect(plain).not.toContain('aria-expanded')
  })

  it('show a shortcut hint only when given one', () => {
    expect(renderToStaticMarkup(<MenuItem shortcut="Ctrl+K">Complete task</MenuItem>)).toContain('Ctrl+K')
    expect(renderToStaticMarkup(<MenuItem>Complete task</MenuItem>)).not.toContain('<kbd')
  })

  it('have a separator and a heading that screen readers skip', () => {
    expect(renderToStaticMarkup(<MenuSeparator />)).toContain('role="separator"')
    expect(renderToStaticMarkup(<MenuHeading>3 tasks</MenuHeading>)).toContain('aria-hidden="true"')
  })
})

describe('option lookup', () => {
  it('includes the radio and checkbox menu items', () => {
    for (const role of ['option', 'menuitem', 'menuitemradio', 'menuitemcheckbox']) {
      expect(OPTION_SELECTOR).toContain(`[role="${role}"]`)
    }
  })

  it('takes the typeahead text from data-typeahead, else the text', () => {
    expect(optionLabel({ dataset: { typeahead: 'Move' }, textContent: 'Move  Ctrl+M' })).toBe('Move')
    expect(optionLabel({ dataset: {}, textContent: '  Low ' })).toBe('Low')
    expect(optionLabel({ dataset: {}, textContent: null })).toBe('')
  })
})

/** Every .tsx under the given folders (relative to src/renderer), as [path, source]. */
function sourcesUnder(...folders: string[]): Array<[string, string]> {
  const found: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full)
      } else if (entry.name.endsWith('.tsx')) {
        found.push([relative(root, full).replace(/\\/g, '/'), readFileSync(full, 'utf-8')])
      }
    }
  }
  for (const folder of folders) walk(resolve(root, folder))
  return found
}

// Modals are the Dialog primitive's job (top layer, inert page, Escape, focus return); a full-screen
// fixed backdrop drawn by hand loses all of that. The toast host, the tooltip and the menu's invisible
// anchor are fixed too, but are not full-screen backdrops.
describe('modals are on the Dialog primitive', () => {
  const files = sourcesUnder('components', 'views', 'quick-entry', 'quick-view')
  const handRolled = /\bfixed\b[^"'`]*\binset-0\b|\binset-0\b[^"'`]*\bfixed\b/

  it('has no hand-rolled full-screen overlay', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.filter(([, source]) => handRolled.test(source)).map(([path]) => path)).toEqual([])
  })

  it('draws no backdrop of its own: only the Dialog primitive styles the backdrop', () => {
    const offenders = files.filter(([path, source]) => path !== 'components/overlay/Dialog.tsx' && /backdrop:|bg-black\/(?:40|45|50)/.test(source)).map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('names the close button of every dialog that has one (an icon alone has no name)', () => {
    const unnamed: string[] = []
    for (const [path, source] of files) {
      if (!/<Dialog[\s>]/.test(source)) continue
      for (const match of source.matchAll(/<button\b[^>]*>\s*<X\b/g)) {
        if (!/aria-label=/.test(match[0])) unnamed.push(path)
      }
    }
    expect(unnamed).toEqual([])
  })
})
