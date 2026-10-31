import { parseAccelerator, type ParsedAccelerator } from '../accelerator'

// What else a key combination already does in Vicu, so Settings can say why a voice shortcut
// would not work. Pure.

interface HotkeyConfig {
  quick_entry_enabled?: boolean
  quick_entry_hotkey?: string
  quick_view_enabled?: boolean
  quick_view_hotkey?: string
}

/** The app's own shortcuts with the platform's main modifier (Settings, Keyboard Shortcuts; the menus). */
const APP_SHORTCUTS: Array<{ keys: string; name: string }> = [
  { keys: 'Mod+N', name: 'New task' },
  { keys: 'Mod+V', name: 'New task from clipboard' },
  { keys: 'Mod+K', name: 'Complete task' },
  { keys: 'Mod+D', name: 'Duplicate task' },
  { keys: 'Mod+T', name: 'Set due date to today' },
  { keys: 'Mod+Enter', name: 'Save and close task' },
  { keys: 'Mod+R', name: 'Refresh' },
  { keys: 'Mod+Shift+R', name: 'Reload' },
  { keys: 'Mod+Shift+C', name: 'Comments' },
  { keys: 'Mod+P', name: 'Print' },
  { keys: 'Mod+,', name: 'Settings' },
]

function same(a: ParsedAccelerator, b: ParsedAccelerator): boolean {
  return a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift && a.key.toLowerCase() === b.key.toLowerCase()
}

/** A sentence naming what the voice shortcut clashes with, or null when nothing does. */
export function voiceHotkeyConflict(hotkey: string, config: HotkeyConfig, isMac: boolean): string | null {
  const voice = parseAccelerator(hotkey, isMac)
  if (!voice) return null
  const globals: Array<{ spec?: string; on?: boolean; name: string }> = [
    { spec: config.quick_entry_hotkey, on: config.quick_entry_enabled, name: 'Quick Entry' },
    { spec: config.quick_view_hotkey, on: config.quick_view_enabled, name: 'Quick View' },
  ]
  for (const global of globals) {
    const other = global.on ? parseAccelerator(global.spec, isMac) : null
    if (other && same(voice, other)) return `This is also the ${global.name} hotkey, which takes it first. Choose another.`
  }
  for (const shortcut of APP_SHORTCUTS) {
    const other = parseAccelerator(shortcut.keys.replace('Mod', isMac ? 'Command' : 'Ctrl'), isMac)
    if (other && same(voice, other)) return `This is already the shortcut for ${shortcut.name}. Choose another.`
  }
  return null
}
