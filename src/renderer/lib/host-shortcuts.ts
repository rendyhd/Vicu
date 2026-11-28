import { isWebHost } from './capabilities'

// A browser keeps a few shortcuts for itself and never shows them to a page: Ctrl+N (new window),
// Ctrl+Shift+N (private window) and Ctrl+T (new tab). The web version uses Alt in place of Ctrl or
// Command for the first two, and has no key of its own for the third ("!" sets a task due today
// everywhere). Specs are written as lib/shortcut-hint.ts reads them.

/** New task. On the desktop it is the application menu's accelerator. */
export const newTaskShortcut = (): string => (isWebHost() ? 'Alt+N' : 'Mod+N')

/** New event, on the Plan screen. */
export const newEventShortcut = (): string => (isWebHost() ? 'Alt+Shift+N' : 'Mod+Shift+N')

/** Whether the host lets the page see Mod+T. */
export const hasModT = (): boolean => !isWebHost()

/** The New event key press. `code` and not `key` on the web: with Alt held a Mac types another letter. */
export function isNewEventKey(event: KeyboardEvent): boolean {
  if (isWebHost()) return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyN'
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n'
}
