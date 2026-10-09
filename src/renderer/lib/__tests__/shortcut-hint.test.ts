import { describe, expect, it } from 'vitest'
import { shortcutHint } from '../shortcut-hint'

describe('shortcutHint', () => {
  it('writes Mod as Ctrl on Windows and Linux', () => {
    expect(shortcutHint('Mod+K', false)).toBe('Ctrl+K')
    expect(shortcutHint('Mod+Shift+P', false)).toBe('Ctrl+Shift+P')
  })

  it('writes Mod as the Command sign on macOS, without separators', () => {
    expect(shortcutHint('Mod+K', true)).toBe('⌘K')
    expect(shortcutHint('Mod+Shift+P', true)).toBe('⌘⇧P')
  })

  it('names the Delete key for each platform', () => {
    expect(shortcutHint('Delete', false)).toBe('Del')
    expect(shortcutHint('Delete', true)).toBe('⌫')
  })

  it('upper-cases letter keys', () => {
    expect(shortcutHint('Mod+c', false)).toBe('Ctrl+C')
  })
})
