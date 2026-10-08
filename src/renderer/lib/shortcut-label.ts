// How a shortcut reads in a tooltip: "Mod+T" is Ctrl+T on Windows and Linux and the command key
// plus T on macOS. Pure, so the platform comes in as an argument.

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' }
const OTHER_KEYS: Record<string, string> = { Mod: 'Ctrl' }

export function shortcutLabel(shortcut: string, isMac: boolean): string {
  const parts = shortcut.split('+').filter(Boolean)
  const keys = isMac ? MAC_KEYS : OTHER_KEYS
  const mapped = parts.map((part) => keys[part] ?? part)
  return isMac ? mapped.join('') : mapped.join('+')
}
