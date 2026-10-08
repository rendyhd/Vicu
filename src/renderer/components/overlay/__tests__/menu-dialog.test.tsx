import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MenuHeading, MenuItem, MenuRadioItem, MenuSeparator } from '../Menu'
import { OPTION_SELECTOR, optionLabel } from '../popover-logic'

const root = resolve(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf-8')

// Card 3.2a (D-20). The behaviour (focus, Escape, light dismiss) is checked in the running app by
// the scenarios context-menu-keys and picker-keys; these keep the structure from drifting.

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

describe('the Menu primitive', () => {
  const menu = read('components/overlay/Menu.tsx')
  const popover = read('components/overlay/Popover.tsx')

  it('is a Popover with role menu', () => {
    expect(menu).toContain("from './Popover'")
    expect(menu).toContain('role="menu"')
  })

  it('opens and closes submenus and pickers from the keyboard', () => {
    expect(menu).toContain("'ArrowRight'")
    expect(menu).toContain("'ArrowLeft'")
  })

  it('has the roving keys on the popover: arrows, type-ahead and Tab to close', () => {
    expect(popover).toContain('typeaheadMatch(')
    expect(popover).toContain("event.key === 'Tab'")
    expect(popover).toContain('hidePopover()')
  })
})

describe('the Dialog primitive', () => {
  const dialog = read('components/overlay/Dialog.tsx')

  it('is a native modal dialog', () => {
    expect(dialog).toContain('<dialog')
    expect(dialog).toContain('showModal()')
  })

  it('closes on the cancel event (Escape) and hands focus back', () => {
    expect(dialog).toContain('onCancel=')
    expect(dialog).toContain('opener')
  })

  it('carries ConfirmDialog and CustomListDialog, which no longer draw their own overlay', () => {
    for (const name of ['ConfirmDialog', 'CustomListDialog']) {
      const source = read(`components/shared/${name}.tsx`)
      expect(source, name).toContain("from '@/components/overlay/Dialog'")
      expect(source, name).toMatch(/<Dialog[\s>]/)
      expect(source, name).not.toContain('fixed inset-0')
    }
  })

  it('names every dialog', () => {
    expect(read('components/shared/ConfirmDialog.tsx')).toContain('label=')
    expect(read('components/shared/CustomListDialog.tsx')).toContain('labelledBy=')
  })
})
