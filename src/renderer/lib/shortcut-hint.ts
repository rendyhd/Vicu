// How a shortcut is written next to a menu entry. Specs use the same words everywhere: "Mod" is
// Ctrl (Windows, Linux) or Command (macOS); the other keys are written as they are on the key.

const NAMES: Record<string, { mac: string; other: string }> = {
  Mod: { mac: '⌘', other: 'Ctrl' },
  Shift: { mac: '⇧', other: 'Shift' },
  Alt: { mac: '⌥', other: 'Alt' },
  Delete: { mac: '⌫', other: 'Del' },
  Enter: { mac: '↩', other: 'Enter' },
  Escape: { mac: 'Esc', other: 'Esc' },
}

/** "Mod+K" becomes "Ctrl+K" or, on macOS, the Command sign and "K" with no separator. */
export function shortcutHint(spec: string, mac: boolean): string {
  const parts = spec.split('+').map((part) => {
    const name = NAMES[part]
    return name ? (mac ? name.mac : name.other) : part.toUpperCase()
  })
  return mac ? parts.join('') : parts.join('+')
}
