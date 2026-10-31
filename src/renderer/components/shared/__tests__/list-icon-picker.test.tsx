import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CUSTOM_LIST_ICONS, customListIcon } from '@/lib/custom-list-icons'
import { List } from 'lucide-react'
import { ListIconPicker, nextIconIndex } from '../ListIconPicker'

const radios = (html: string) => html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []

describe('ListIconPicker', () => {
  it('draws every icon as a named radio, the chosen one checked and the only tab stop', () => {
    const html = renderToStaticMarkup(<ListIconPicker value="favorite" onChange={() => {}} labelledBy="icon" />)
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-labelledby="icon"')
    const buttons = radios(html)
    expect(buttons).toHaveLength(CUSTOM_LIST_ICONS.length)
    expect(html.match(/<svg/g)).toHaveLength(CUSTOM_LIST_ICONS.length)
    const checked = buttons.filter((b) => b.includes('aria-checked="true"'))
    expect(checked).toHaveLength(1)
    expect(checked[0]).toContain('aria-label="Heart"')
    expect(checked[0]).toContain('tabindex="0"')
    expect(buttons.filter((b) => b.includes('tabindex="0"'))).toHaveLength(1)
  })

  it('checks nothing for a key from a newer version and keeps the first icon reachable', () => {
    const buttons = radios(renderToStaticMarkup(<ListIconPicker value="rocket" onChange={() => {}} />))
    expect(buttons.some((b) => b.includes('aria-checked="true"'))).toBe(false)
    expect(buttons[0]).toContain('tabindex="0"')
  })

  it('moves with the arrows, wrapping, and jumps with Home and End', () => {
    expect(nextIconIndex('ArrowRight', 0, 17)).toBe(1)
    expect(nextIconIndex('ArrowDown', 16, 17)).toBe(0)
    expect(nextIconIndex('ArrowLeft', 0, 17)).toBe(16)
    expect(nextIconIndex('ArrowUp', 5, 17)).toBe(4)
    expect(nextIconIndex('Home', 9, 17)).toBe(0)
    expect(nextIconIndex('End', 2, 17)).toBe(16)
    expect(nextIconIndex('Enter', 2, 17)).toBeNull()
  })
})

describe('custom list icons', () => {
  it('keeps the keys that sync, which the mobile app draws too', () => {
    expect(CUSTOM_LIST_ICONS.map((o) => o.key)).toEqual([
      'filter_list', 'folder', 'star', 'favorite', 'home', 'work', 'school', 'shopping_cart', 'fitness',
      'code', 'pets', 'auto_awesome', 'lightbulb', 'bookmark', 'flag', 'build', 'palette',
    ])
  })

  it('resolves a stored key, and nothing for an empty or unknown one', () => {
    expect(customListIcon('favorite')).toBe(CUSTOM_LIST_ICONS[3].icon)
    expect(customListIcon(undefined)).toBeUndefined()
    expect(customListIcon('rocket')).toBeUndefined()
  })
})

describe('a list without an icon (cross-app semantics 3)', () => {
  it('offers None first when asked and draws a None list without an icon', async () => {
    const { listIconOrNone } = await import('@/lib/custom-list-icons')
    const html = renderToStaticMarkup(<ListIconPicker value="none" onChange={() => {}} allowNone />)
    expect(html.indexOf('aria-label="None"')).toBeGreaterThan(-1)
    expect(html.indexOf('aria-label="None"')).toBeLessThan(html.indexOf('aria-label="Folder"'))
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="None"/)
    expect(renderToStaticMarkup(<ListIconPicker value="none" onChange={() => {}} />)).not.toContain('aria-label="None"')
    expect(listIconOrNone('none', List)).toBeNull()
    expect(listIconOrNone('', List)).toBe(List)
    expect(listIconOrNone('star', List)).not.toBe(List)
  })
})
