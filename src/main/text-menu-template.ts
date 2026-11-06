// What the right-click menu of a text selection or a text field holds. Nothing in here
// touches Electron at runtime, so it can be unit-tested directly; the glue lives in
// text-context-menu.ts.
import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

export type TextMenuParams = Pick<
  ContextMenuParams,
  'isEditable' | 'selectionText' | 'editFlags' | 'misspelledWord' | 'dictionarySuggestions'
>

/**
 * The menu for a right click the page left alone. A page with its own menu (a task row, a
 * sidebar item) calls preventDefault, so this never competes with it.
 *
 * - A text field: spelling suggestions when the word is misspelled, then Cut, Copy, Paste and
 *   Select all, greyed out when they do not apply.
 * - Selected text that cannot be edited: Copy.
 * - Anywhere else: nothing, so no menu opens.
 *
 * Undo and Redo stay out: the notes editor keeps its own history, which Chromium's flags do not see.
 */
export function textMenuTemplate(
  params: TextMenuParams,
  replaceMisspelling: (suggestion: string) => void
): MenuItemConstructorOptions[] {
  const { editFlags } = params

  if (!params.isEditable) {
    if (params.selectionText.trim() === '') return []
    return [{ role: 'copy', enabled: editFlags.canCopy }]
  }

  const suggestions: MenuItemConstructorOptions[] = params.misspelledWord
    ? params.dictionarySuggestions.map((suggestion) => ({
        label: suggestion,
        click: () => replaceMisspelling(suggestion),
      }))
    : []

  return [
    ...suggestions,
    ...(suggestions.length > 0 ? [{ type: 'separator' as const }] : []),
    { role: 'cut', enabled: editFlags.canCut },
    { role: 'copy', enabled: editFlags.canCopy },
    { role: 'paste', enabled: editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: editFlags.canSelectAll },
  ]
}
