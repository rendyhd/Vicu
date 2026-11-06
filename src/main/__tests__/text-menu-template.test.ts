import { describe, expect, it, vi } from 'vitest'
import { textMenuTemplate, type TextMenuParams } from '../text-menu-template'

const flags = {
  canUndo: false,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false,
}

const params = (over: Partial<TextMenuParams> = {}): TextMenuParams => ({
  isEditable: false,
  selectionText: '',
  editFlags: flags,
  misspelledWord: '',
  dictionarySuggestions: [],
  ...over,
})

const shape = (items: ReturnType<typeof textMenuTemplate>) => items.map((item) => item.role ?? item.label ?? item.type)

describe('textMenuTemplate', () => {
  it('opens no menu where there is no text to act on', () => {
    expect(textMenuTemplate(params(), vi.fn())).toEqual([])
    expect(textMenuTemplate(params({ selectionText: ' \n ' }), vi.fn())).toEqual([])
  })

  it('offers only Copy for selected text that cannot be edited', () => {
    expect(shape(textMenuTemplate(params({ selectionText: 'Renew passport' }), vi.fn()))).toEqual(['copy'])
  })

  it('offers Cut, Copy, Paste and Select all in a text field', () => {
    expect(shape(textMenuTemplate(params({ isEditable: true }), vi.fn()))).toEqual([
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ])
  })

  it('greys out what the field says does not apply', () => {
    const items = textMenuTemplate(
      params({ isEditable: true, editFlags: { ...flags, canCut: false, canCopy: false } }),
      vi.fn()
    )
    const enabled = Object.fromEntries(items.filter((item) => item.role).map((item) => [item.role, item.enabled]))
    expect(enabled).toEqual({ cut: false, copy: false, paste: true, selectAll: true })
  })

  it('puts spelling suggestions first, and a choice replaces the word', () => {
    const replace = vi.fn()
    const items = textMenuTemplate(
      params({ isEditable: true, misspelledWord: 'pasport', dictionarySuggestions: ['passport', 'pass port'] }),
      replace
    )
    expect(shape(items).slice(0, 3)).toEqual(['passport', 'pass port', 'separator'])
    items[0].click?.({} as never, undefined, {} as never)
    expect(replace).toHaveBeenCalledWith('passport')
  })

  it('adds no separator for a misspelled word without suggestions', () => {
    const items = textMenuTemplate(params({ isEditable: true, misspelledWord: 'qwxz' }), vi.fn())
    expect(shape(items)[0]).toBe('cut')
  })
})
